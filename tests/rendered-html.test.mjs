import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("the production build contains the Pika Note product shell", async () => {
  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const files = await readdir(assetsUrl);
  const appBundleName = files.find((name) => name.startsWith("PikaNoteApp-") && name.endsWith(".js"));
  assert.ok(appBundleName, "Pika Note client bundle was not emitted");
  const [bundle, layout, manifest] = await Promise.all([
    readFile(new URL(appBundleName, assetsUrl), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
  ]);

  assert.match(bundle, /Pika Note/i);
  assert.match(bundle, /Keep a thought\. Find it fast\./i);
  assert.match(bundle, /Find a thought/i);
  assert.match(bundle, /Cloud synced/i);
  assert.match(bundle, /Shared notebook/);
  assert.match(bundle, /anyone with the link can view, edit, and delete notes and photos/);
  assert.doesNotMatch(bundle, /Private by design|ACCESS_REQUIRED|TEAM_DOMAIN|POLICY_AUD/);
  assert.match(layout, /Pika Note — Your notes, wherever you are/i);
  assert.match(manifest, /display:\s*"standalone"/i);
  assert.doesNotMatch(`${bundle}${layout}`, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("ships Cloudflare persistence and installable-app assets", async () => {
  const [wrangler, migration, serviceWorker] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_spotty_roughhouse.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(wrangler, /"binding":\s*"DB"/);
  assert.match(wrangler, /"binding":\s*"NOTE_IMAGES"/);
  assert.match(wrangler, /"name":\s*"pika-note"/);
  assert.match(migration, /CREATE TABLE `notes`/);
  assert.match(migration, /CREATE TABLE `note_images`/);
  assert.doesNotMatch(serviceWorker, /\/api\/.+cache/i);
  for (const [name, size] of [["favicon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const source = await readFile(new URL(`../public/${name}`, import.meta.url));
    const built = await readFile(new URL(`../dist/client/${name}`, import.meta.url));
    assert.deepEqual(source.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${name} is a PNG`);
    assert.equal(source.readUInt32BE(16), size, `${name} width`);
    assert.equal(source.readUInt32BE(20), size, `${name} height`);
    assert.deepEqual(built, source, `${name} is included unchanged in the deployable assets`);
  }
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
});

test("the mobile palette keeps text and primary controls readable", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const mobileRoot = css.match(/@media\s*\(max-width:\s*799px\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(mobileRoot, "the icon palette is scoped to mobile screens");
  const colors = Object.fromEntries([...mobileRoot.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
  const luminance = (hex) => {
    assert.match(hex, /^#[\da-f]{6}$/i);
    const linear = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  for (const [foreground, background] of [
    [colors["--ink"], colors["--paper"]],
    [colors["--ink"], colors["--card"]],
    [colors["--muted"], colors["--paper"]],
    [colors["--muted"], colors["--card"]],
    [colors["--muted"], "#f7ebfc"],
    ["#ffffff", colors["--accent"]],
    ["#ffffff", colors["--accent-deep"]],
  ]) {
    const [dark, light] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    const ratio = (light + 0.05) / (dark + 0.05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast; expected at least 4.5:1`);
  }
});

test("the offline screen and its artwork load from cache without caching API data", async () => {
  const [source, offline] = await Promise.all([
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
  ]);
  const handlers = new Map();
  const cache = new Map([
    ["/offline.html", offline],
    ["/icon-192.png?v=2", await readFile(new URL("../public/icon-192.png", import.meta.url))],
  ]);
  runInNewContext(source, {
    URL,
    self: { location: { origin: "https://pika-note.example" }, addEventListener: (event, handler) => handlers.set(event, handler) },
    fetch: async () => { throw new Error("Offline"); },
    caches: { match: async (request) => {
      const url = new URL(typeof request === "string" ? request : request.url, "https://pika-note.example");
      const body = cache.get(`${url.pathname}${url.search}`);
      return body === undefined ? undefined : new Response(body);
    } },
  });
  const fetchEvent = (path, mode) => {
    let response;
    handlers.get("fetch")({
      request: { url: new URL(path, "https://pika-note.example").href, method: "GET", mode },
      respondWith: (value) => { response = value; },
    });
    return response;
  };
  const page = await fetchEvent("/", "navigate");
  const html = await page.text();
  assert.match(html, /You’re offline/);
  const icon = html.match(/<img\b[^>]*src="([^"]+)"/)?.[1];
  assert.ok(icon, "offline screen references the app artwork");
  const image = await fetchEvent(icon, "no-cors");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), cache.get(icon));
  assert.equal(fetchEvent("/api/notes", "cors"), undefined);
  assert.equal(fetchEvent("/api/images/example", "no-cors"), undefined);
  assert.equal(fetchEvent("/other-image.png", "no-cors"), undefined);
});
