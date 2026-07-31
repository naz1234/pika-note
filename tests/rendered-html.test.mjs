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
  assert.match(layout, /Pika Note — Your notes, wherever you are/i);
  assert.match(manifest, /display:\s*"standalone"/i);
  assert.doesNotMatch(`${bundle}${layout}`, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("ships Cloudflare persistence and installable-app assets", async () => {
  const [hosting, wrangler, migration, serviceWorker] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_spotty_roughhouse.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1":\s*"DB"/);
  assert.match(hosting, /"r2":\s*"NOTE_IMAGES"/);
  assert.match(wrangler, /"name":\s*"pika-note"/);
  assert.match(migration, /CREATE TABLE `notes`/);
  assert.match(migration, /CREATE TABLE `note_images`/);
  assert.doesNotMatch(serviceWorker, /\/api\/.+cache/i);
  await access(new URL("../public/icon-192.png", import.meta.url));
  await access(new URL("../public/icon-512.png", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
});
