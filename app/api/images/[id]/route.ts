import { and, eq } from "drizzle-orm";
import { ensureSchema, getDb, getImageBucket } from "../../../../db";
import { noteImages, notes } from "../../../../db/schema";
import { ApiError, apiError, apiJson, requireOwner, requireSameOrigin } from "../../../../lib/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    await ensureSchema();
    const [image] = await getDb().select().from(noteImages)
      .where(and(eq(noteImages.id, id), eq(noteImages.owner, owner))).limit(1);
    if (!image) throw new ApiError(404, "That image was not found.", "NOT_FOUND");
    const object = await getImageBucket().get(image.objectKey);
    if (!object) throw new ApiError(404, "That image was not found in storage.", "NOT_FOUND");
    const etag = object.httpEtag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });

    return new Response(object.body, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.originalName)}`,
        "Cache-Control": "private, max-age=300",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
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
    const [image] = await db.select().from(noteImages)
      .where(and(eq(noteImages.id, id), eq(noteImages.owner, owner))).limit(1);
    if (!image) throw new ApiError(404, "That image was not found.", "NOT_FOUND");
    await db.delete(noteImages).where(and(eq(noteImages.id, id), eq(noteImages.owner, owner)));
    await db.update(notes).set({ updatedAt: new Date().toISOString() })
      .where(and(eq(notes.id, image.noteId), eq(notes.owner, owner)));
    try { await getImageBucket().delete(image.objectKey); } catch (cleanupError) {
      console.error("Pika Note could not clean up an R2 image", cleanupError);
    }
    return apiJson({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
