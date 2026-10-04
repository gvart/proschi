/** An error with the status and message the client sees. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status, { 'Cache-Control': 'no-store' });
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

const MAX_BODY = 128 * 1024;

/** The JSON object in the request body; 400 for anything else, 413 past 128 KiB. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Request body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The body must be a JSON object');
  return body as Record<string, unknown>;
}
