import { and, eq, sql } from "drizzle-orm";
import { ensureSchema, getDb, getImageBucket } from "../../../../db";
import { noteImages, notes, NOTE_COLORS } from "../../../../db/schema";
import { noteDto } from "../../../../lib/note-dto";
import { ApiError, apiError, apiJson, cleanText, requireJson, requireOwner, requireSameOrigin } from "../../../../lib/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    requireJson(request);
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const expectedVersion = payload.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new ApiError(400, "The note version is missing.", "INVALID_VERSION");
    }

    await ensureSchema();
    const db = getDb();
    const [current] = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.owner, owner))).limit(1);
    if (!current) throw new ApiError(404, "That note was not found.", "NOT_FOUND");

    const title = payload.title === undefined ? current.title : cleanText(payload.title, "Title", 200);
    const content = payload.content === undefined ? current.content : cleanText(payload.content, "Note", 100_000);
    const color = payload.color === undefined
      ? current.color
      : typeof payload.color === "string" && NOTE_COLORS.includes(payload.color as (typeof NOTE_COLORS)[number])
        ? payload.color as (typeof NOTE_COLORS)[number]
        : (() => { throw new ApiError(400, "Choose a valid note color.", "INVALID_NOTE"); })();
    const isPinned = payload.isPinned === undefined ? current.isPinned : Boolean(payload.isPinned);
    const isArchived = payload.isArchived === undefined ? current.isArchived : Boolean(payload.isArchived);

    const [updated] = await db
      .update(notes)
      .set({
        title,
        content,
        color,
        isPinned,
        isArchived,
        version: sql`${notes.version} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(notes.id, id), eq(notes.owner, owner), eq(notes.version, Number(expectedVersion))))
      .returning();

    if (!updated) {
      const [latest] = await db.select().from(notes).where(and(eq(notes.id, id), eq(notes.owner, owner))).limit(1);
      const images = latest
        ? await db.select().from(noteImages).where(and(eq(noteImages.noteId, id), eq(noteImages.owner, owner)))
        : [];
      throw new ApiError(409, "This note changed on another device.", "VERSION_CONFLICT", {
        latest: latest ? noteDto(latest, images) : null,
      });
    }

    const images = await db.select().from(noteImages).where(and(eq(noteImages.noteId, id), eq(noteImages.owner, owner)));
    return apiJson({ note: noteDto(updated, images) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const owner = await requireOwner(request);
    const { id } = await context.params;
    await ensureSchema();
    const db = getDb();
    const [current] = await db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, id), eq(notes.owner, owner))).limit(1);
    if (!current) throw new ApiError(404, "That note was not found.", "NOT_FOUND");

    const images = await db.select({ id: noteImages.id, objectKey: noteImages.objectKey })
      .from(noteImages)
      .where(and(eq(noteImages.noteId, id), eq(noteImages.owner, owner)));
    await db.delete(noteImages).where(and(eq(noteImages.noteId, id), eq(noteImages.owner, owner)));
    await db.delete(notes).where(and(eq(notes.id, id), eq(notes.owner, owner)));

    if (images.length) {
      try {
        await getImageBucket().delete(images.map((image) => image.objectKey));
      } catch (cleanupError) {
        console.error("Pika Note could not clean up deleted R2 images", cleanupError);
      }
    }
    return apiJson({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
