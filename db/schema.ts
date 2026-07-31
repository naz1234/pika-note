import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const NOTE_COLORS = ["yellow", "coral", "sage", "lavender", "sky"] as const;

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    color: text("color", { enum: NOTE_COLORS }).notNull().default("yellow"),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("notes_owner_archive_updated_idx").on(table.owner, table.isArchived, table.updatedAt),
    index("notes_owner_pinned_updated_idx").on(table.owner, table.isPinned, table.updatedAt),
  ],
);

export const noteImages = sqliteTable(
  "note_images",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("note_images_note_owner_idx").on(table.noteId, table.owner),
    uniqueIndex("note_images_object_key_idx").on(table.objectKey),
  ],
);
