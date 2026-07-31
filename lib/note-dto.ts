import type { noteImages, notes } from "../db/schema";

type NoteRow = typeof notes.$inferSelect;
type ImageRow = typeof noteImages.$inferSelect;

export function imageDto(image: ImageRow) {
  return {
    id: image.id,
    filename: image.originalName,
    mimeType: image.mimeType,
    size: image.byteSize,
    createdAt: image.createdAt,
    url: `/api/images/${image.id}`,
  };
}

export function noteDto(note: NoteRow, images: ImageRow[] = []) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    color: note.color,
    isPinned: note.isPinned,
    isArchived: note.isArchived,
    version: note.version,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    attachments: images.map(imageDto),
  };
}
