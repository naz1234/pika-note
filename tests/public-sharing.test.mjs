import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://pika-note.example";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");

test("the deployed notebook is public, shared, and persistent", { timeout: 60_000 }, async (t) => {
  const storage = await mkdtemp(join(tmpdir(), "pika-note-sharing-"));
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const options = {
    modules: true,
    scriptPath: fileURLToPath(new URL("../dist/server/public-sharing-entry.js", import.meta.url)),
    // Miniflare's HTTP transport replaces Host with its local listener. Restore
    // it from the original URL before invoking the unmodified production app,
    // so both the framework and route-level same-origin checks run faithfully.
    script: `import app from "./index.js";
      export default { fetch(request, env, ctx) {
        const headers = new Headers(request.headers);
        headers.set("Host", new URL(request.url).host);
        return app.fetch(new Request(request, { headers }), env, ctx);
      } };`,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    cf: false,
    d1Databases: ["DB"],
    r2Buckets: ["NOTE_IMAGES"],
    d1Persist: join(storage, "d1"),
    r2Persist: join(storage, "r2"),
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
  };
  let worker = new Miniflare(options);
  t.after(async () => {
    await worker.dispose();
    await rm(storage, { recursive: true, force: true });
  });

  // These clients never send cookies or Access tokens. Use a production-style
  // hostname so a localhost-only authentication exemption cannot pass the test.
  const visitor = (name) => async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", name);
    headers.set("Host", new URL(origin).host);
    if (init.method && init.method !== "GET") headers.set("Origin", origin);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    // Serialize with the native Request so Node and Miniflare agree on the
    // multipart boundary even when their FormData implementations differ.
    const request = new Request(`${origin}${path}`, { ...init, headers });
    return worker.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body ? new Uint8Array(await request.arrayBuffer()) : undefined,
    });
  };
  const alice = visitor("visitor-a");
  const bob = visitor("visitor-b");
  const json = async (response, status = 200) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };

  await t.test("anonymous visitors can open the app and API without Access settings", async () => {
    const page = await alice("/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Shared notebook/);
    for (const [container, size, src, pixels] of [
      ["brand-lockup", "small", "/icon-192.png?v=2", 48],
      ["editor-welcome", "large", "/icon-512.png?v=2", 144],
    ]) {
      const region = html.split(`class="${container}"`)[1]?.split("</div>")[0] ?? "";
      const brandImage = region.match(/<img\b[^>]*>/)?.[0] ?? "";
      assert.ok(brandImage.includes(`class="brand-mark brand-mark--${size}"`), `${container} uses the artwork`);
      assert.ok(brandImage.includes(`src="${src}"`), `${container} uses the installed app icon`);
      assert.ok(brandImage.includes(`width="${pixels}"`) && brandImage.includes(`height="${pixels}"`), `${container} reserves a square image area`);
      assert.ok(brandImage.includes('alt=""') && brandImage.includes('aria-hidden="true"'), `${container} does not repeat adjacent branding to screen readers`);
    }
    assert.doesNotMatch(html, /welcome-stack|>✦</);
    const metaTags = html.match(/<meta\b[^>]*>/g) ?? [];
    for (const [media, color] of [["(max-width: 799px)", "#fff5fb"], ["(min-width: 800px)", "#f7f3e8"]]) {
      assert.ok(metaTags.some((tag) => tag.includes('name="theme-color"') && tag.includes(`media="${media}"`) && tag.includes(`content="${color}"`)), `Browser chrome matches the ${media} theme`);
    }
    const links = html.match(/<link\b[^>]*>/g) ?? [];
    for (const [rel, href, sizes] of [
      ["icon", "/favicon-32.png?v=2", "32x32"],
      ["icon", "/icon-192.png?v=2", "192x192"],
      ["icon", "/icon-512.png?v=2", "512x512"],
      ["apple-touch-icon", "/apple-touch-icon.png?v=2", "180x180"],
    ]) {
      assert.ok(links.some((link) => link.includes(`rel="${rel}"`) && link.includes(`href="${origin}${href}"`) && link.includes(`sizes="${sizes}"`)), `App metadata links to ${href}`);
    }
    assert.ok(links.some((link) => link.includes('rel="manifest"') && link.includes(`href="${origin}/manifest.webmanifest"`)));
    const manifest = await json(await alice("/manifest.webmanifest"));
    assert.equal(manifest.background_color, "#fff5fb");
    assert.equal(manifest.theme_color, "#fff5fb");
    assert.deepEqual(manifest.icons, [
      { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
    ]);
    const response = await alice("/api/notes?archived=all");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await json(response), { notes: [] });
  });

  const db = await worker.getD1Database("DB");
  const bucket = await worker.getR2Bucket("NOTE_IMAGES");
  const now = new Date().toISOString();
  // Model an upgrade from the email-owned database, retaining original IDs,
  // versions, owner metadata, and R2 keys rather than making an empty notebook.
  await db.batch([
    db.prepare("INSERT INTO notes (id, owner, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("legacy-a", "first@example.test", "Existing note A", now, now),
    db.prepare("INSERT INTO notes (id, owner, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("legacy-b", "second@example.test", "Existing note B", now, now),
    db.prepare("INSERT INTO note_images (id, note_id, owner, object_key, original_name, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("legacy-photo", "legacy-a", "first@example.test", "notes/legacy-a/legacy-photo", "legacy.png", "image/png", png.length, now),
  ]);
  await bucket.put("notes/legacy-a/legacy-photo", png);

  await t.test("existing notes and photos from different owners are shared without exposing emails", async () => {
    const a = await json(await alice("/api/notes?archived=all"));
    const b = await json(await bob("/api/notes?archived=all"));
    assert.deepEqual(a, b);
    assert.deepEqual(a.notes.map((note) => note.id).sort(), ["legacy-a", "legacy-b"]);
    assert.doesNotMatch(JSON.stringify(a), /first@example|second@example|objectKey|"owner"/);
    assert.equal(a.notes.find((note) => note.id === "legacy-a").attachments[0].url, "/api/images/legacy-photo");
    const photo = await bob("/api/images/legacy-photo");
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
    assert.equal(await db.prepare("SELECT owner FROM notes WHERE id = ?").bind("legacy-a").first("owner"), "first@example.test");
    const staleSession = await worker.dispatchFetch(`${origin}/api/notes?archived=all`, {
      headers: { "cf-access-jwt-assertion": "expired.session.token", Cookie: "CF_Authorization=stale" },
    });
    assert.deepEqual(await json(staleSession), a);
  });

  await t.test("shared edits, pinning, archiving, and restoration retain version conflicts", async () => {
    const { note } = await json(await bob("/api/notes/legacy-a", {
      method: "PATCH", body: JSON.stringify({ expectedVersion: 1, content: "Shared edit", isPinned: true, isArchived: true }),
    }));
    assert.equal(note.version, 2);
    assert.equal(note.isPinned, true);
    assert.equal(note.attachments.length, 1);
    assert.deepEqual((await json(await alice("/api/notes?archived=1"))).notes.map((n) => n.id), ["legacy-a"]);
    assert.deepEqual((await json(await alice("/api/notes"))).notes.map((n) => n.id), ["legacy-b"]);
    const conflict = await json(await alice("/api/notes/legacy-a", {
      method: "PATCH", body: JSON.stringify({ expectedVersion: 1, content: "Stale edit" }),
    }), 409);
    assert.equal(conflict.code, "VERSION_CONFLICT");
    assert.equal(conflict.latest.content, "Shared edit");
    assert.equal(conflict.latest.attachments.length, 1);
    await json(await alice("/api/notes/legacy-a", {
      method: "PATCH", body: JSON.stringify({ expectedVersion: 2, isArchived: false }),
    }));
  });

  let newId;
  let attachment;
  await t.test("new notes and uploaded photos are visible to a second anonymous visitor", async () => {
    const { note } = await json(await alice("/api/notes", {
      method: "POST", body: JSON.stringify({ title: "Public note", content: "Saved for everyone" }),
    }), 201);
    newId = note.id;
    const form = new FormData();
    form.set("image", new File([png], "shared.png", { type: "image/png" }));
    ({ attachment } = await json(await bob(`/api/notes/${newId}/images`, { method: "POST", body: form }), 201));
    const shared = (await json(await bob("/api/notes?archived=all"))).notes.find((n) => n.id === newId);
    assert.equal(shared.title, "Public note");
    assert.equal(shared.attachments[0].id, attachment.id);
    assert.equal(await db.prepare("SELECT owner FROM notes WHERE id = ?").bind(newId).first("owner"), "shared");
  });

  await t.test("origin, content-type, note, and image validation remain enforced", async () => {
    for (const requestOrigin of [null, "https://unrelated.example"]) {
      for (const [path, method] of [["/api/notes", "POST"], ["/api/notes/legacy-a", "PATCH"], ["/api/notes/legacy-a", "DELETE"], ["/api/notes/legacy-a/images", "POST"], ["/api/images/legacy-photo", "DELETE"]]) {
        const headers = requestOrigin ? { Origin: requestOrigin } : {};
        const response = await worker.dispatchFetch(`${origin}${path}`, { method, headers });
        assert.equal((await json(response, 403)).code, "ORIGIN_REJECTED");
      }
    }
    const nonJson = await worker.dispatchFetch(`${origin}/api/notes`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "{}" });
    assert.equal((await json(nonJson, 415)).code, "INVALID_CONTENT_TYPE");
    assert.equal((await json(await alice("/api/notes", { method: "POST", body: JSON.stringify({ title: "x".repeat(201) }) }), 400)).code, "INVALID_NOTE");
    const form = new FormData();
    form.set("image", new File(["not an image"], "fake.png", { type: "image/png" }));
    assert.equal((await json(await alice(`/api/notes/${newId}/images`, { method: "POST", body: form }), 415)).code, "INVALID_IMAGE_TYPE");
  });

  await t.test("notes and image bytes survive a Worker restart", async () => {
    await worker.dispose();
    worker = new Miniflare(options);
    const { notes } = await json(await bob("/api/notes?archived=all"));
    assert.equal(notes.find((note) => note.id === newId).content, "Saved for everyone");
    const photo = await bob(attachment.url);
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  });

  await t.test("another visitor can remove shared images and delete notes with R2 cleanup", async () => {
    await json(await bob("/api/images/legacy-photo", { method: "DELETE" }));
    await json(await alice("/api/images/legacy-photo"), 404);
    const currentBucket = await worker.getR2Bucket("NOTE_IMAGES");
    assert.equal(await currentBucket.get("notes/legacy-a/legacy-photo"), null);
    await json(await bob(`/api/notes/${newId}`, { method: "DELETE" }));
    await json(await alice(attachment.url), 404);
    assert.equal(await currentBucket.get(`notes/${newId}/${attachment.id}`), null);
    assert.equal((await json(await alice("/api/notes?archived=all"))).notes.some((note) => note.id === newId), false);
  });
});
