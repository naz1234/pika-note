export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_ERROR",
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Keep the legacy non-null owner columns without tying new content to a visitor.
// Existing rows remain in place; all notes and attachments belong to the public notebook.
export const SHARED_NOTEBOOK_OWNER = "shared";

export function requireSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") return;
  if (!origin || origin !== url.origin) {
    throw new ApiError(403, "This change must come from Pika Note itself.", "ORIGIN_REJECTED");
  }
}

export function requireJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Send this request as JSON.", "INVALID_CONTENT_TYPE");
  }
}

export function apiJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return apiJson({ error: error.message, code: error.code, ...error.extra }, error.status);
  }

  console.error("Pika Note API error", error);
  return apiJson({ error: "Pika Note hit an unexpected problem. Please try again.", code: "SERVER_ERROR" }, 500);
}

export function cleanText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") throw new ApiError(400, `${field} must be text.`, "INVALID_NOTE");
  if (value.length > maximum) throw new ApiError(400, `${field} is too long.`, "INVALID_NOTE");
  return value;
}
