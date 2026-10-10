import { titleOf } from '../../frontend/src/playground/documents';
import { fileMap } from '../../frontend/src/playground/sanitize';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';

/**
 * Short share links (backend/README.md "Short links and embeds"): a signed-in
 * user publishes a diagram at /s/<id>, with an optional preview PNG the page
 * rendered, so link previews show the diagram and designs can be embedded
 * (/embed/?s=<id>). Anyone with the link can read a share; only its owner
 * can delete it, and it goes with the account. docs/PRIVACY.md says the same.
 *
 *   POST   /api/shares {source, imports?, image?}   stores one: {id, url, title, hasImage, createdAt}
 *   GET    /api/shares/<id>                          the diagram, for the editor and the embed page
 *   DELETE /api/shares/<id>                          the owner's only
 *   GET    /api/me/shares                            the user's shares, newest first
 *   GET    /api/oembed?url=                          oEmbed (rich) for a /s/<id> or /embed/?s=<id> link
 *   GET    /s/<id>                                   a page with the preview's meta tags that opens the editor
 *   GET    /s/<id>.png                               the preview (or /og.png without one)
 */

/** The whole document, source and imported files (paths included), in characters: as much as a practice design. */
export const MAX_SHARE_DOC = 64 * 1024;
/** The preview PNG, in bytes. */
export const MAX_SHARE_IMAGE = 300 * 1024;
/** Widest and tallest preview accepted, in pixels (the page renders 1200×630). */
export const MAX_IMAGE_SIDE = 2400;
/** Shares a user may keep; delete one to make another. */
export const MAX_SHARES_PER_USER = 100;
/** The document, the base64 of the image and JSON's escapes. */
const MAX_SHARE_BODY = 768 * 1024;
const ID_LENGTH = 10;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const SHARE_ID = /^[A-Za-z0-9]{10}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A share never changes, so its image can be kept for a year. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** A share can be deleted: answers that show one are cached briefly. */
const SHORT_CACHE = 'public, max-age=300';
const NO_STORE = { 'Cache-Control': 'no-store' };
const DESCRIPTION = 'An architecture diagram made with Proschi. Open it to see the diagram, play its request flows and check load, latency and cost.';

/** 10 random base62 characters (about 59 bits), unbiased: bytes past the last whole multiple of 62 are dropped. */
export function newShareId(): string {
  let id = '';
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && id.length < ID_LENGTH) id += BASE62[byte % 62];
    }
  }
  return id;
}

/** The width and height of a PNG, or an error message: the signature, an IHDR chunk first, sane dimensions and an IEND chunk last. */
export function checkPng(bytes: Uint8Array): { width: number; height: number } | string {
  if (bytes.length < 8 + 25 + 12 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return 'image must be a PNG';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (view.getUint32(8) !== 13 || type(12) !== 'IHDR') return 'image must be a PNG';
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return `image must be at most ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} pixels`;
  const end = bytes.length - 12;
  if (view.getUint32(end) !== 0 || type(end + 4) !== 'IEND') return 'image is not a complete PNG';
  return { width, height };
}

function decodeBase64(text: string): Uint8Array | undefined {
  const data = text.replace(/^data:image\/png;base64,/, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return undefined;
  try {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** D1 answers a BLOB as an array of bytes (or, in some versions, an ArrayBuffer). */
function blobBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value as ArrayLike<number>);
}

/** The site's origin, for absolute links in meta tags and snippets. */
const originOf = (request: Request): string => new URL(request.url).origin;
export const shareUrl = (origin: string, id: string): string => `${origin}/s/${id}`;

/** POST /api/shares {source, imports?, image?}: `image` is a base64 PNG (a data: URL is fine). */
export async function createShare(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.SHARE_LIMITER, user.id, 'Too many short links; wait a minute');
  const body = await readJson(request, MAX_SHARE_BODY);
  if (typeof body.source !== 'string' || !body.source.trim()) throw new HttpError(400, 'source must be a non-empty string');
  const source = body.source;
  let imports: Record<string, string> | undefined;
  if (body.imports !== undefined && body.imports !== null) {
    imports = fileMap(body.imports);
    if (!imports || Object.keys(imports).length !== Object.keys(body.imports as object).length) {
      throw new HttpError(400, 'imports must map file paths to sources');
    }
  }
  const size = source.length + Object.entries(imports ?? {}).reduce((n, [path, text]) => n + path.length + text.length, 0);
  if (size > MAX_SHARE_DOC) throw new HttpError(413, `The diagram and its imports must be at most ${MAX_SHARE_DOC / 1024} KiB`);

  let image: Uint8Array | undefined;
  let dimensions: { width: number; height: number } | undefined;
  if (body.image !== undefined && body.image !== null) {
    if (typeof body.image !== 'string') throw new HttpError(400, 'image must be a base64 PNG');
    image = decodeBase64(body.image);
    if (!image) throw new HttpError(400, 'image must be a base64 PNG');
    if (image.length > MAX_SHARE_IMAGE) throw new HttpError(413, `image must be at most ${MAX_SHARE_IMAGE / 1024} KB`);
    const checked = checkPng(image);
    if (typeof checked === 'string') throw new HttpError(400, checked);
    dimensions = checked;
  }

  const { DB } = ctx.env;
  const count = await DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_SHARES_PER_USER) {
    throw new HttpError(409, `You have ${MAX_SHARES_PER_USER} short links, the most there can be; delete one first`);
  }
  const id = newShareId();
  const title = titleOf(source).slice(0, 200);
  const createdAt = now();
  await DB.prepare(
    'INSERT INTO shares (id, user_id, title, source, imports, image, image_width, image_height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, title, source, imports ? JSON.stringify(imports) : null, image ?? null, dimensions?.width ?? null, dimensions?.height ?? null, createdAt)
    .run();
  return json({ id, url: shareUrl(originOf(request), id), title, hasImage: image !== undefined, createdAt }, 201, NO_STORE);
}

interface ShareRow {
  id: string;
  title: string;
  source: string;
  imports: string | null;
  has_image: number;
  image_width: number | null;
  image_height: number | null;
  created_at: number;
}

/** A short link, unless its owner is blocked (src/admin.ts): then it answers as if deleted. */
async function findShare(ctx: Ctx, id: string): Promise<ShareRow | null> {
  if (!SHARE_ID.test(id)) return null;
  return ctx.env.DB.prepare(
    `SELECT s.id, s.title, s.source, s.imports, s.image IS NOT NULL AS has_image, s.image_width, s.image_height, s.created_at
     FROM shares s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.blocked_at IS NULL`,
  )
    .bind(id)
    .first<ShareRow>();
}

/** GET /api/shares/<id>: no sign-in needed; the owner is not named. */
export async function getShare(ctx: Ctx, id: string): Promise<Response> {
  const row = await findShare(ctx, id);
  if (!row) throw new HttpError(404, 'No such short link; it may have been deleted');
  return json(
    {
      id: row.id,
      title: row.title,
      source: row.source,
      ...(row.imports ? { imports: JSON.parse(row.imports) as Record<string, string> } : {}),
      hasImage: row.has_image === 1,
      createdAt: row.created_at,
    },
    200,
    { 'Cache-Control': SHORT_CACHE },
  );
}

/** DELETE /api/shares/<id>: 404 unless it is the user's. */
export async function deleteShare(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const user = await requireUser(request, ctx);
  if (!SHARE_ID.test(id)) throw new HttpError(404, 'No such short link');
  const { meta } = await ctx.env.DB.prepare('DELETE FROM shares WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (meta.changes === 0) throw new HttpError(404, 'No such short link');
  return new Response(null, { status: 204 });
}

/** GET /api/me/shares */
export async function listShares(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const origin = originOf(request);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, title, image IS NOT NULL AS has_image, created_at FROM shares WHERE user_id = ? ORDER BY created_at DESC, id',
  )
    .bind(user.id)
    .all<Pick<ShareRow, 'id' | 'title' | 'has_image' | 'created_at'>>();
  return json(
    { shares: results.map((r) => ({ id: r.id, url: shareUrl(origin, r.id), title: r.title, hasImage: r.has_image === 1, createdAt: r.created_at })), max: MAX_SHARES_PER_USER },
    200,
    NO_STORE,
  );
}

/** The user's shares for GET /api/me/export: everything but the image's bytes, which `imageUrl` serves. */
export async function exportShares(DB: D1Database, userId: string, origin: string): Promise<unknown[]> {
  const { results } = await DB.prepare(
    'SELECT id, title, source, imports, image IS NOT NULL AS has_image, image_width, image_height, created_at FROM shares WHERE user_id = ? ORDER BY created_at, id',
  )
    .bind(userId)
    .all<ShareRow>();
  return results.map((r) => ({
    id: r.id,
    url: shareUrl(origin, r.id),
    title: r.title,
    source: r.source,
    imports: r.imports ? (JSON.parse(r.imports) as unknown) : null,
    imageUrl: r.has_image === 1 ? `${shareUrl(origin, r.id)}.png` : null,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    createdAt: r.created_at,
  }));
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The iframe that embeds a share. */
export function embedSnippet(origin: string, id: string, title: string, width: number | string = '100%', height = 480): string {
  return `<iframe src="${origin}/embed/?s=${id}" title="${escapeHtml(title)} · Proschi" width="${width}" height="${height}" style="border:0" loading="lazy" allowfullscreen></iframe>`;
}

/**
 * GET /s/<id>: for link previews, the share's title and image in Open Graph
 * and Twitter tags; for people, a redirect (a meta refresh: the page runs no
 * script) to the editor, which loads the diagram with GET /api/shares/<id>.
 */
export async function sharePage(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const row = await findShare(ctx, id);
  if (!row) {
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link not found · Proschi</title></head><body><p>This short link does not exist, or its owner deleted it. <a href="/app/">Open the Proschi editor</a></p></body></html>`;
    return new Response(page, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const origin = originOf(request);
  const url = shareUrl(origin, row.id);
  const editor = `/app/?s=${row.id}`;
  const title = escapeHtml(row.title);
  const image = row.has_image === 1 ? `${url}.png` : `${origin}/og.png`;
  const width = row.has_image === 1 ? row.image_width : 1200;
  const height = row.has_image === 1 ? row.image_height : 630;
  const oembed = `${origin}/api/oembed?url=${encodeURIComponent(url)}&format=json`;
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Proschi</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembed)}" title="${title}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Proschi">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="${width}">
<meta property="og:image:height" content="${height}">
<meta property="og:image:alt" content="Diagram: ${title}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${editor}">
</head>
<body>
<p>Opening <a href="${editor}">${title}</a> in the Proschi editor…</p>
</body>
</html>
`;
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': SHORT_CACHE } });
}

/** GET /s/<id>.png: the preview, kept for a year (a share never changes); without one, a redirect to the site's image. */
export async function shareImage(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const row = SHARE_ID.test(id) ? await ctx.env.DB.prepare('SELECT s.image FROM shares s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.blocked_at IS NULL').bind(id).first<{ image: unknown }>() : null;
  if (!row?.image) {
    return new Response(null, { status: 302, headers: { Location: `${originOf(request)}/og.png`, 'Cache-Control': 'public, max-age=3600' } });
  }
  const bytes = blobBytes(row.image);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': IMMUTABLE,
      // Link previews and chat apps may load it from their own pages.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

/** The share id of a /s/<id>, /embed/?s=<id> or /app/?s=<id> link on this site. */
export function shareIdOf(link: string, origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  const short = /^\/s\/([A-Za-z0-9]{10})$/.exec(url.pathname)?.[1];
  if (short) return short;
  const param = url.searchParams.get('s') ?? '';
  return /^\/(embed|app)\/$/.test(url.pathname) && SHARE_ID.test(param) ? param : undefined;
}

/** GET /api/oembed?url=&format=json&maxwidth=&maxheight=: an oEmbed "rich" answer with the embed's iframe. */
export async function oembed(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const params = new URL(request.url).searchParams;
  const format = params.get('format') ?? 'json';
  if (format !== 'json') throw new HttpError(501, 'Only format=json is offered');
  const origin = originOf(request);
  const id = shareIdOf(params.get('url') ?? '', origin);
  const row = id ? await findShare(ctx, id) : null;
  if (!row) throw new HttpError(404, 'No such short link');
  const limit = (name: string, fallback: number) => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
  };
  const width = limit('maxwidth', 800);
  const height = limit('maxheight', 480);
  return json(
    {
      version: '1.0',
      type: 'rich',
      provider_name: 'Proschi',
      provider_url: `${origin}/`,
      title: row.title,
      html: embedSnippet(origin, row.id, row.title, width, height),
      width,
      height,
      ...(row.has_image === 1 ? { thumbnail_url: `${shareUrl(origin, row.id)}.png`, thumbnail_width: row.image_width, thumbnail_height: row.image_height } : {}),
      cache_age: 300,
    },
    200,
    { 'Cache-Control': SHORT_CACHE },
  );
}
