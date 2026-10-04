import type { Ctx } from './context';

/** An error with the status, message and any headers (e.g. Retry-After) the client sees. */
export class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function errorResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: message }, status, { 'Cache-Control': 'no-store', ...headers });
}

/**
 * Every API answer: the request id, and headers that keep it from being
 * sniffed as another type, framed, sent on in a Referer or loaded by other
 * sites. Adds the Set-Cookie values the handlers queued in `ctx`.
 */
export function withSecurityHeaders(response: Response, ctx: Ctx): Response {
  // A copy: a Response from fetch() or a redirect may have immutable headers.
  const out = new Response(response.body, response);
  const headers = out.headers;
  headers.set('X-Request-Id', ctx.requestId);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  for (const cookie of ctx.setCookies) headers.append('Set-Cookie', cookie);
  return out;
}

/**
 * Requests that change something must come from this site. The session
 * cookie is SameSite=Lax, which already keeps it off cross-site POSTs; this
 * also refuses any request whose Origin (sent by browsers on every POST,
 * PATCH and DELETE) is another site.
 */
export function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-site request refused');
}

/** 429 with Retry-After once `key` used up its allowance of `limiter` (a minute's worth, wrangler.jsonc). */
export async function rateLimit(limiter: RateLimit, key: string, message: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, message, { 'Retry-After': '60' });
}

export const MAX_BODY = 128 * 1024;

/** The JSON object in the request body; 400 for anything else, 413 past `max` bytes (128 KiB). */
export async function readJson(request: Request, max = MAX_BODY): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'Request body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The body must be a JSON object');
  return body as Record<string, unknown>;
}
