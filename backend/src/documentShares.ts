import { titleOf } from '../../frontend/src/playground/documents';
import type { User } from './auth';
import type { Ctx } from './context';
import { checkId, limited } from './documents';
import { HttpError, json, rateLimit } from './http';

/**
 * Live share links (backend/README.md "Live share links", docs/design/paid-plans.md
 * P11 and P13): a Pro user's private, revocable, read-only link to one of
 * their synced diagrams, at /share/<token>. Unlike a short link
 * (src/shares.ts), a snapshot anyone signed in can make, it shows the diagram
 * as it is now, and its owner can revoke it. A diagram has at most one live
 * link; revoking it and sharing again gives a new token.
 *
 *   GET    /api/me/documents/<id>/share   the diagram's live link: {share: {token, url, createdAt} | null}
 *   POST   /api/me/documents/<id>/share   Pro only (402 plan_required): its live link, made if there is none
 *   DELETE /api/me/documents/<id>/share   revokes it (404 without one)
 *   GET    /api/share/<token>             public: the diagram now, {name, title, source, imports?, updatedAt}
 *
 * The public answer names neither the owner nor the document's id. It answers
 * 404 alike for a token that never existed, a revoked one, a deleted diagram,
 * a blocked owner and an owner no longer on Pro.
 */

/** 16 random bytes in base64url: 22 characters. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Whether the account may make share links: `users.plan` is 'pro'. Read here, not from src/plans.ts. */
export const isPro = (user: Pick<User, 'plan'>): boolean => user.plan === 'pro';

/** 128 random bits, base64url without padding. */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export const liveShareUrl = (origin: string, token: string): string => `${origin}/share/${token}`;

interface ShareRow {
  token: string;
  created_at: number;
}

function shareOf(request: Request, row: ShareRow) {
  return { token: row.token, url: liveShareUrl(new URL(request.url).origin, row.token), createdAt: row.created_at };
}

const liveShare = (DB: D1Database, userId: string, documentId: string) =>
  DB.prepare('SELECT token, created_at FROM document_shares WHERE user_id = ? AND document_id = ? AND revoked_at IS NULL').bind(userId, documentId).first<ShareRow>();

/** GET /api/me/documents/<id>/share */
export async function getDocumentShare(request: Request, ctx: Ctx, rawId: string): Promise<Response> {
  const id = checkId(rawId);
  const user = await limited(request, ctx);
  const row = await liveShare(ctx.env.DB, user.id, id);
  return json({ share: row ? shareOf(request, row) : null }, 200, NO_STORE);
}

/** POST /api/me/documents/<id>/share: 402 {error: 'plan_required'} off Pro, 404 for a diagram the account does not keep. */
export async function createDocumentShare(request: Request, ctx: Ctx, rawId: string): Promise<Response> {
  const id = checkId(rawId);
  const user = await limited(request, ctx);
  if (!isPro(user)) return json({ error: 'plan_required', message: 'Live share links are part of Pro' }, 402, NO_STORE);
  const { DB } = ctx.env;
  const existing = await liveShare(DB, user.id, id);
  if (existing) return json({ share: shareOf(request, existing) }, 200, NO_STORE);
  // Only a live diagram; the unique index keeps a concurrent second insert out.
  const row = await DB.prepare(
    `INSERT INTO document_shares (token, user_id, document_id, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM documents WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL)
     ON CONFLICT DO NOTHING
     RETURNING token, created_at`,
  )
    .bind(newShareToken(), user.id, id, Date.now())
    .first<ShareRow>();
  if (row) return json({ share: shareOf(request, row) }, 201, NO_STORE);
  const raced = await liveShare(DB, user.id, id);
  if (raced) return json({ share: shareOf(request, raced) }, 200, NO_STORE);
  throw new HttpError(404, 'No such diagram in your account; it may not be synced yet');
}

/** DELETE /api/me/documents/<id>/share: the link stops working at once; its token is never reused. */
export async function revokeDocumentShare(request: Request, ctx: Ctx, rawId: string): Promise<Response> {
  const id = checkId(rawId);
  const user = await limited(request, ctx);
  const { meta } = await ctx.env.DB.prepare('UPDATE document_shares SET revoked_at = ? WHERE user_id = ? AND document_id = ? AND revoked_at IS NULL')
    .bind(Date.now(), user.id, id)
    .run();
  if (meta.changes === 0) throw new HttpError(404, 'This diagram has no share link');
  return new Response(null, { status: 204 });
}

interface PublicRow {
  name: string;
  source: string;
  imports: string | null;
  updated_at: number;
}

/** GET /api/share/<token>: no sign-in, rate-limited per IP, never cached (a revoke takes effect at once). */
export async function getSharedDocument(ctx: Ctx, token: string): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const row = SHARE_TOKEN.test(token)
    ? await ctx.env.DB.prepare(
        `SELECT d.name, d.source, d.imports, d.updated_at
         FROM document_shares s
         JOIN documents d ON d.user_id = s.user_id AND d.id = s.document_id
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.revoked_at IS NULL AND d.deleted_at IS NULL AND u.blocked_at IS NULL AND u.plan = 'pro'`,
      )
        .bind(token)
        .first<PublicRow>()
    : null;
  if (!row) throw new HttpError(404, 'No such share link; it may have been revoked');
  return json(
    {
      name: row.name,
      title: titleOf(row.source).slice(0, 200),
      source: row.source,
      ...(row.imports ? { imports: JSON.parse(row.imports) as Record<string, string> } : {}),
      updatedAt: row.updated_at,
    },
    200,
    { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  );
}

/** The user's share links for "Download my data", revoked ones too. */
export async function exportDocumentShares(DB: D1Database, userId: string, origin: string): Promise<unknown[]> {
  const { results } = await DB.prepare('SELECT token, document_id, created_at, revoked_at FROM document_shares WHERE user_id = ? ORDER BY created_at, rowid')
    .bind(userId)
    .all<ShareRow & { document_id: string; revoked_at: number | null }>();
  return results.map((r) => ({ url: liveShareUrl(origin, r.token), documentId: r.document_id, createdAt: r.created_at, revokedAt: r.revoked_at }));
}

/** /share/<token>: the built site's share page (frontend/share/), which reads the token from its address; never indexed. */
export async function shareViewPage(request: Request, assets: Fetcher): Promise<Response> {
  const page = await assets.fetch(new Request(new URL('/share/', request.url), { method: request.method, headers: request.headers }));
  const out = new Response(page.body, page);
  out.headers.set('X-Robots-Tag', 'noindex');
  // The token is the link's only secret: it must not leave in a Referer.
  out.headers.set('Referrer-Policy', 'no-referrer');
  return out;
}
