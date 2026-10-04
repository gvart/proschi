import type { Env } from './env';

/** One request's bindings, ids for the log, and what handlers add to the response. */
export interface Ctx {
  env: Env;
  exec: ExecutionContext;
  /** The caller's X-Request-Id when it looks like one, else a new id; echoed in the response and the log. */
  requestId: string;
  /** The client's IP (CF-Connecting-IP), the key of the per-IP rate limits. */
  ip: string;
  /** Set-Cookie values to add to the response, e.g. a renewed session. */
  setCookies: string[];
  /** The signed-in user, once a handler has read the session; for the log. */
  userId?: string;
}

export function createContext(request: Request, env: Env, exec: ExecutionContext): Ctx {
  const incoming = request.headers.get('X-Request-Id');
  return {
    env,
    exec,
    requestId: incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID(),
    ip: request.headers.get('CF-Connecting-IP') ?? 'unknown',
    setCookies: [],
  };
}
