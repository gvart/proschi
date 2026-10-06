import { requireUser } from './auth';
import type { Ctx } from './context';
import { HttpError, json, rateLimit, readJson } from './http';

/**
 * The editor's diagrams in the account (cloud sync, frontend/src/playground/sync.ts).
 * Each write names the version it was based on: a stale one gets 409 with the
 * server's copy, so the page can keep both instead of losing either. Deleting
 * leaves a tombstone, which `since` reports to other devices, pruned after
 * 30 days by the daily cron.
 */

/** Live (not deleted) documents a user may keep. */
export const MAX_DOCUMENTS = 200;
/** A document's source plus its imports (as JSON), in characters: the same as a practice design. */
export const MAX_DOCUMENT = 64 * 1024;
/** Tombstones older than this are deleted by the daily cron. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NAME = 512;
const MAX_IMPORTS = 100;
/** The JSON of a document at its size cap, escaped. */
const MAX_BODY = 4 * MAX_DOCUMENT;
const NO_STORE = { 'Cache-Control': 'no-store' };

export interface CloudDocument {
  id: string;
  name: string;
  source: string;
  imports: Record<string, string> | null;
  version: number;
  /** Unix milliseconds. */
  updatedAt: number;
  /** Unix milliseconds; null unless deleted (a tombstone, its name, source and imports empty). */
  deletedAt: number | null;
}

interface Row {
  id: string;
  name: string;
  source: string;
  imports: string | null;
  version: number;
  updated_at: number;
  deleted_at: number | null;
}

const COLUMNS = 'id, name, source, imports, version, updated_at, deleted_at';

function documentOf(row: Row): CloudDocument {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    imports: row.imports === null ? null : (JSON.parse(row.imports) as Record<string, string>),
    version: row.version,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function checkId(id: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) throw new HttpError(400, 'A document id is 1 to 100 letters, digits, dots, dashes or underscores');
  return id;
}

async function limited(request: Request, ctx: Ctx): Promise<string> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.DOCS_LIMITER, user.id, 'Too many diagram saves; wait a minute');
  return user.id;
}

/** GET /api/me/documents?since=<ms>: documents changed at or after `since` (all without), tombstones included. */
export async function listDocuments(request: Request, ctx: Ctx): Promise<Response> {
  const userId = await limited(request, ctx);
  const raw = new URL(request.url).searchParams.get('since');
  const since = raw === null || raw === '' ? 0 : Number(raw);
  if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'since must be a time in Unix milliseconds');
  // Read before the query: a change committed meanwhile is at or after it, so the next `since` finds it.
  const cursor = Date.now();
  const { results } = await ctx.env.DB.prepare(`SELECT ${COLUMNS} FROM documents WHERE user_id = ? AND updated_at >= ? ORDER BY updated_at, id`)
    .bind(userId, since)
    .all<Row>();
  return json({ documents: results.map(documentOf), cursor }, 200, NO_STORE);
}

function readImports(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'imports must be an object of path → source');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_IMPORTS) throw new HttpError(413, `At most ${MAX_IMPORTS} imports`);
  for (const [path, source] of entries) {
    if (!path || path.length > MAX_NAME || typeof source !== 'string') throw new HttpError(400, 'imports must be an object of path → source');
  }
  return entries.length ? (value as Record<string, string>) : null;
}

/**
 * PUT /api/me/documents/<id> {name, source, imports?, baseVersion}: saves a
 * document. `baseVersion` is the version the page last had (0: none, a new
 * document). 409 {document} with the server's copy when it changed since;
 * a document the account no longer has at all (its tombstone pruned) is
 * created again. 413 past the size or count cap.
 */
export async function putDocument(request: Request, ctx: Ctx, rawId: string): Promise<Response> {
  const id = checkId(rawId);
  const userId = await limited(request, ctx);
  const body = await readJson(request, MAX_BODY);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > MAX_NAME) throw new HttpError(400, `name must be a file name of 1 to ${MAX_NAME} characters`);
  if (typeof body.source !== 'string') throw new HttpError(400, 'source must be a string');
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, 'baseVersion must be a whole number, 0 for a new document');
  const imports = readImports(body.imports);
  const importsJson = imports ? JSON.stringify(imports) : null;
  if (body.source.length + (importsJson?.length ?? 0) > MAX_DOCUMENT) throw new HttpError(413, 'This diagram is too large to save to your account (64 KiB)');

  const { DB } = ctx.env;
  const t = Date.now();
  const room = `(SELECT COUNT(*) FROM documents WHERE user_id = ?1 AND deleted_at IS NULL) < ${MAX_DOCUMENTS}`;
  // The version it was based on: saved. A tombstone counts toward the cap again once restored.
  const updated = await DB.prepare(
    `UPDATE documents SET name = ?3, source = ?4, imports = ?5, updated_at = ?6, deleted_at = NULL, version = version + 1
     WHERE user_id = ?1 AND id = ?2 AND version = ?7 AND (deleted_at IS NULL OR ${room})
     RETURNING ${COLUMNS}`,
  )
    .bind(userId, id, body.name, body.source, importsJson, t, baseVersion)
    .first<Row>();
  if (updated) return json({ document: documentOf(updated) }, 200, NO_STORE);

  const inserted = await DB.prepare(
    `INSERT INTO documents (user_id, id, name, source, imports, updated_at, version)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, 1 WHERE ${room}
     ON CONFLICT (user_id, id) DO NOTHING
     RETURNING ${COLUMNS}`,
  )
    .bind(userId, id, body.name, body.source, importsJson, t)
    .first<Row>();
  if (inserted) return json({ document: documentOf(inserted) }, 200, NO_STORE);

  const existing = await DB.prepare(`SELECT ${COLUMNS} FROM documents WHERE user_id = ? AND id = ?`).bind(userId, id).first<Row>();
  if (existing && existing.version !== baseVersion) {
    return json({ error: 'The diagram changed on another device', document: documentOf(existing) }, 409, NO_STORE);
  }
  throw new HttpError(413, `Your account holds ${MAX_DOCUMENTS} diagrams, the most it can; the rest stay in this browser`);
}

/**
 * DELETE /api/me/documents/<id>?baseVersion=: leaves a tombstone. With
 * `baseVersion`, 409 {document} when the document changed since. A document
 * the account does not have is already gone: 204.
 */
export async function deleteDocument(request: Request, ctx: Ctx, rawId: string): Promise<Response> {
  const id = checkId(rawId);
  const userId = await limited(request, ctx);
  const raw = new URL(request.url).searchParams.get('baseVersion');
  const baseVersion = raw === null ? null : Number(raw);
  if (baseVersion !== null && (!Number.isSafeInteger(baseVersion) || baseVersion < 0)) throw new HttpError(400, 'baseVersion must be a whole number');
  const { DB } = ctx.env;
  const row = await DB.prepare(
    `UPDATE documents SET name = '', source = '', imports = NULL, deleted_at = ?3, updated_at = ?3, version = version + 1
     WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL AND (?4 IS NULL OR version = ?4)
     RETURNING ${COLUMNS}`,
  )
    .bind(userId, id, Date.now(), baseVersion)
    .first<Row>();
  if (row) return json({ document: documentOf(row) }, 200, NO_STORE);
  const existing = await DB.prepare(`SELECT ${COLUMNS} FROM documents WHERE user_id = ? AND id = ?`).bind(userId, id).first<Row>();
  if (!existing) return new Response(null, { status: 204 });
  if (existing.deleted_at !== null) return json({ document: documentOf(existing) }, 200, NO_STORE);
  return json({ error: 'The diagram changed on another device', document: documentOf(existing) }, 409, NO_STORE);
}

/** DELETE /api/me/documents: "Delete my cloud copies", every document and tombstone of the account, at once. */
export async function deleteAllDocuments(request: Request, ctx: Ctx): Promise<Response> {
  const userId = await limited(request, ctx);
  const { meta } = await ctx.env.DB.prepare('DELETE FROM documents WHERE user_id = ?').bind(userId).run();
  return json({ deleted: meta.changes }, 200, NO_STORE);
}

/** The documents in "Download my data", tombstones included. */
export async function exportDocuments(DB: D1Database, userId: string): Promise<CloudDocument[]> {
  const { results } = await DB.prepare(`SELECT ${COLUMNS} FROM documents WHERE user_id = ? ORDER BY updated_at, id`).bind(userId).all<Row>();
  return results.map(documentOf);
}
