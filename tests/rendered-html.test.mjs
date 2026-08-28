import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

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
