import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { noteImages, notes, NOTE_COLORS } from "../../../db/schema";
import { noteDto } from "../../../lib/note-dto";
import { ApiError, apiError, apiJson, cleanText, requireJson, requireOwner, requireSameOrigin } from "../../../lib/server";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    await ensureSchema();
    const db = getDb();
    const archived = new URL(request.url).searchParams.get("archived");
    const where = archived === "all"
      ? eq(notes.owner, owner)
      : and(eq(notes.owner, owner), eq(notes.isArchived, archived === "1"));
    const rows = await db
      .select()
      .from(notes)
      .where(where)
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
      .limit(300);

    const images = rows.length
      ? await db
          .select()
          .from(noteImages)
          .where(and(eq(noteImages.owner, owner), inArray(noteImages.noteId, rows.map((note) => note.id))))
          .orderBy(desc(noteImages.createdAt))
      : [];
    const byNote = new Map<string, typeof images>();
    for (const image of images) byNote.set(image.noteId, [...(byNote.get(image.noteId) ?? []), image]);

    return apiJson({ notes: rows.map((note) => noteDto(note, byNote.get(note.id) ?? [])) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    requireJson(request);
    const owner = await requireOwner(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const title = cleanText(payload.title ?? "", "Title", 200);
    const content = cleanText(payload.content ?? "", "Note", 100_000);
    const color = typeof payload.color === "string" && NOTE_COLORS.includes(payload.color as (typeof NOTE_COLORS)[number])
      ? payload.color as (typeof NOTE_COLORS)[number]
      : "yellow";
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID(),
      owner,
      title,
      content,
      color,
      isPinned: false,
      isArchived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await ensureSchema();
    const [created] = await getDb().insert(notes).values(note).returning();
    if (!created) throw new ApiError(500, "The note could not be created.", "CREATE_FAILED");
    return apiJson({ note: noteDto(created) }, 201);
  } catch (error) {
    return apiError(error);
  }
}
