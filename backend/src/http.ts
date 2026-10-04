import type { Env } from './env';

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

export function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** CORS for the allowed origins. The API authenticates with bearer tokens, not cookies, so no credentials mode. */
export function withCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return response;
  const out = new Response(response.body, response);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.append('Vary', 'Origin');
  return out;
}

export function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
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
