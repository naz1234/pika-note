import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the mobile photo button opens a gallery-capable picker", async () => {
  const source = await readFile(new URL("../app/PikaNoteApp.tsx", import.meta.url), "utf8");
  const fileInput = source.split("\n").find((line) => line.includes('type="file"'));

  assert.ok(fileInput, "the photo file input is present");
  assert.match(fileInput, /\bmultiple\b/, "users can select several gallery photos");
  assert.match(fileInput, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.doesNotMatch(fileInput, /\bcapture(?:\s|=)/, "the picker must not force the device camera");
});
