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

interface AccessEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

interface AccessJwtHeader {
  alg?: string;
  kid?: string;
}

interface AccessJwtPayload {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
}

type AccessJwk = JsonWebKey & { kid?: string };

interface AccessJwks {
  keys?: AccessJwk[];
}

let accessKeys: { expiresAt: number; keys: AccessJwk[] } | null = null;

function decodeJwtPart<T>(value: string): T {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function decodeSignature(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function getAccessKeys(teamDomain: string, forceRefresh = false) {
  if (!forceRefresh && accessKeys && accessKeys.expiresAt > Date.now()) return accessKeys.keys;
  let response: Response;
  try {
    response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch {
    throw new ApiError(503, "Cloudflare Access keys could not be reached. Please try again.", "ACCESS_CHECK_FAILED");
  }
  if (!response.ok) throw new ApiError(503, "Cloudflare Access keys could not be checked. Please try again.", "ACCESS_CHECK_FAILED");
  const payload = await response.json() as AccessJwks;
  if (!Array.isArray(payload.keys) || !payload.keys.length) {
    throw new ApiError(503, "Cloudflare Access did not return signing keys.", "ACCESS_CHECK_FAILED");
  }
  accessKeys = { keys: payload.keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return payload.keys;
}

async function verifyAccessToken(token: string, teamDomain: string, audience: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "Cloudflare Access sent an invalid session.", "ACCESS_REQUIRED");
  const header = decodeJwtPart<AccessJwtHeader>(parts[0]);
  const payload = decodeJwtPart<AccessJwtPayload>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new ApiError(401, "Cloudflare Access sent an unsupported session.", "ACCESS_REQUIRED");

  let keys = await getAccessKeys(teamDomain);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await getAccessKeys(teamDomain, true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new ApiError(401, "Cloudflare Access signing key was not found.", "ACCESS_REQUIRED");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeSignature(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!validSignature
    || payload.iss !== teamDomain
    || !audiences.includes(audience)
    || typeof payload.exp !== "number"
    || payload.exp <= now
    || (typeof payload.iat === "number" && payload.iat > now + 60)
    || typeof payload.email !== "string"
    || !payload.email.trim()) {
    throw new ApiError(401, "Your Cloudflare Access session is not valid for Pika Note.", "ACCESS_REQUIRED");
  }
  return payload.email.trim().toLowerCase();
}

export async function requireOwner(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "local-preview@pika.note";
  }

  const bindings = (await import("cloudflare:workers")).env as unknown as AccessEnv;
  const teamDomain = bindings.TEAM_DOMAIN?.trim().replace(/\/$/, "");
  const audience = bindings.POLICY_AUD?.trim();
  if (!teamDomain || !audience || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    throw new ApiError(401, "Add TEAM_DOMAIN and POLICY_AUD in the Worker settings to finish private access.", "ACCESS_REQUIRED");
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    throw new ApiError(401, "Cloudflare Access is required before Pika Note can open your private notebook.", "ACCESS_REQUIRED");
  }
  try {
    return await verifyAccessToken(token, teamDomain, audience);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Cloudflare Access sent an invalid session.", "ACCESS_REQUIRED");
  }
}

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
