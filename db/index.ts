import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

interface PikaEnv {
  DB: D1Database;
  NOTE_IMAGES: R2Bucket;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    owner TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'yellow',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notes_owner_archive_updated_idx
    ON notes (owner, is_archived, updated_at)`,
  `CREATE INDEX IF NOT EXISTS notes_owner_pinned_updated_idx
    ON notes (owner, is_pinned, updated_at)`,
  `CREATE TABLE IF NOT EXISTS note_images (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS note_images_note_owner_idx
    ON note_images (note_id, owner)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS note_images_object_key_idx
    ON note_images (object_key)`,
];

let schemaReady: Promise<void> | null = null;

function getBindings(): PikaEnv {
  const bindings = env as unknown as Partial<PikaEnv>;
  if (!bindings.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  if (!bindings.NOTE_IMAGES) {
    throw new Error("Cloudflare R2 binding `NOTE_IMAGES` is unavailable.");
  }
  return bindings as PikaEnv;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const { DB } = getBindings();
    schemaReady = DB.batch(schemaStatements.map((statement) => DB.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

export function getDb() {
  return drizzle(getBindings().DB, { schema });
}

export function getImageBucket() {
  return getBindings().NOTE_IMAGES;
}
