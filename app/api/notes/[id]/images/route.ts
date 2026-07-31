import { and, count, eq } from "drizzle-orm";
import { ensureSchema, getDb, getImageBucket } from "../../../../../db";
import { noteImages, notes } from "../../../../../db/schema";
import { imageDto } from "../../../../../lib/note-dto";
import { ApiError, apiError, apiJson, requireOwner, requireSameOrigin } from "../../../../../lib/server";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_NOTE = 12;

function detectImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  let uploadedKey: string | null = null;
  try {
    requireSameOrigin(request);
    const owner = await requireOwner(request);
    const { id: noteId } = await context.params;
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES + 512_000) throw new ApiError(413, "That image is larger than 10 MB.", "IMAGE_TOO_LARGE");

    await ensureSchema();
    const db = getDb();
    const [note] = await db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, noteId), eq(notes.owner, owner))).limit(1);
    if (!note) throw new ApiError(404, "That note was not found.", "NOT_FOUND");
    const [{ value: imageCount }] = await db.select({ value: count() }).from(noteImages)
      .where(and(eq(noteImages.noteId, noteId), eq(noteImages.owner, owner)));
    if (imageCount >= MAX_IMAGES_PER_NOTE) throw new ApiError(400, "A note can hold up to 12 images.", "IMAGE_LIMIT");

    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) throw new ApiError(400, "Choose an image to upload.", "IMAGE_MISSING");
    if (image.size === 0) throw new ApiError(400, "That image is empty.", "INVALID_IMAGE");
    if (image.size > MAX_IMAGE_BYTES) throw new ApiError(413, "That image is larger than 10 MB.", "IMAGE_TOO_LARGE");
    const detectedType = detectImageType(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
    if (!detectedType) throw new ApiError(415, "Use a JPEG, PNG, WebP, or GIF image.", "INVALID_IMAGE_TYPE");
    if (image.type && image.type !== detectedType) throw new ApiError(415, "That file does not match its image type.", "INVALID_IMAGE_TYPE");

    const imageId = crypto.randomUUID();
    uploadedKey = `notes/${noteId}/${imageId}`;
    const originalName = (image.name || "note-image").replace(/[\u0000-\u001f]/g, "").slice(0, 180);
    await getImageBucket().put(uploadedKey, image.stream(), {
      httpMetadata: { contentType: detectedType },
      customMetadata: { noteId, imageId },
    });
    const now = new Date().toISOString();
    const [created] = await db.insert(noteImages).values({
      id: imageId,
      noteId,
      owner,
      objectKey: uploadedKey,
      originalName,
      mimeType: detectedType,
      byteSize: image.size,
      createdAt: now,
    }).returning();
    await db.update(notes).set({ updatedAt: now }).where(and(eq(notes.id, noteId), eq(notes.owner, owner)));
    return apiJson({ attachment: imageDto(created) }, 201);
  } catch (error) {
    if (uploadedKey) {
      try { await getImageBucket().delete(uploadedKey); } catch { /* private orphan cleanup can be retried later */ }
    }
    return apiError(error);
  }
}
