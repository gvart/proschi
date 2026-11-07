import { auditStatement, requireAdmin } from './adminAuth';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { now, type Env } from './env';
import { HttpError, json, readJson } from './http';
import { MAX_SHARE_DOC } from './shares';

/**
 * Feedback: signed-in users write to the operator from the app (a bug, a
 * question, a proposal or anything else), and the admin panel's Inbox reads
 * it (backend/README.md "Feedback"). No email goes out, there is no reply
 * thread: the admin answers by email when the account has an address.
 *
 *   POST   /api/feedback   multipart: kind, subject?, message, path?, viewport?, diagram?, screenshot (0–3 files)
 *   GET    /api/admin/feedback?status=new|in_progress|done|open&kind=&q=&offset=   50 at a time, newest first, with the counts
 *   GET    /api/admin/feedback/<id>            one message with its context, diagram and screenshots (marks it read)
 *   PATCH  /api/admin/feedback/<id> {status?, note?}   audited
 *   DELETE /api/admin/feedback/<id> {reason}   deletes it with its screenshots, audited
 *   GET    /api/admin/feedback/<id>/files/<key>   one screenshot, to the admin only
 *
 * Screenshots live in R2 (FEEDBACK_BUCKET) under random keys, never at a
 * public address; their type is checked by their first bytes, not the
 * browser's word. They are deleted with the message and, before it, with
 * the account (deleteFeedbackFiles).
 */

export const KINDS = ['bug', 'question', 'proposal', 'other'] as const;
export const STATUSES = ['new', 'in_progress', 'done'] as const;
type Kind = (typeof KINDS)[number];
type Status = (typeof STATUSES)[number];

export const MAX_MESSAGE = 5000;
export const MAX_SUBJECT = 200;
export const MAX_NOTE = 5000;
export const MAX_FILES = 3;
export const MAX_FILE = 5 * 1024 * 1024;
/** Messages a user may send per hour and per day, counted in D1. */
export const PER_HOUR = 5;
export const PER_DAY = 20;
/** The whole body: the screenshots, the diagram and the text, with room for the multipart framing. */
const MAX_BODY = MAX_FILES * MAX_FILE + MAX_SHARE_DOC + 64 * 1024;
const MAX_REASON = 500;
const PAGE = 50;
const NO_STORE = { 'Cache-Control': 'no-store' };
const ID = /^[0-9a-f-]{36}$/;
const KEY = /^[A-Za-z0-9_-]{22,64}$/;

/** The image type `bytes` start like, of the three accepted; undefined for anything else (an SVG, an HTML page renamed .png). */
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

/** A form field as trimmed text of at most `max` characters, or 400. */
function text(form: FormData, name: string, max: number, required = false): string {
  const value = form.get(name);
  if (value !== null && typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
  const trimmed = (value ?? '').trim();
  if (required && !trimmed) throw new HttpError(400, `Write a ${name}`);
  if (trimmed.length > max) throw new HttpError(400, `${name} is too long (at most ${max.toLocaleString('en')} characters)`);
  return trimmed;
}

/** Up to `max` characters of a context field, without control characters; '' when absent. */
const contextField = (form: FormData, name: string, max: number): string => {
  const value = form.get(name);
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
};

/** A random object key: 128 bits, base64url. */
function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** POST /api/feedback: one message, with its context and, if the user chose, the diagram and screenshots. */
export async function postFeedback(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const { env } = ctx;
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) throw new HttpError(413, 'Too large: screenshots can be 5 MB each');
  const t = now();
  const sent = await env.DB.prepare('SELECT COALESCE(SUM(created_at > ?2), 0) AS hour, COUNT(*) AS day FROM feedback_messages WHERE user_id = ?1 AND created_at > ?3')
    .bind(user.id, t - 3600, t - 86_400)
    .first<{ hour: number; day: number }>();
  if ((sent?.hour ?? 0) >= PER_HOUR || (sent?.day ?? 0) >= PER_DAY) {
    throw new HttpError(429, `You have sent a lot of messages: at most ${PER_HOUR} an hour and ${PER_DAY} a day. Try again later.`, { 'Retry-After': '3600' });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'The body must be multipart/form-data');
  }
  const kind = form.get('kind');
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  const subject = text(form, 'subject', MAX_SUBJECT);
  const message = text(form, 'message', MAX_MESSAGE, true);
  const diagramValue = form.get('diagram');
  if (diagramValue !== null && typeof diagramValue !== 'string') throw new HttpError(400, 'diagram must be text');
  const diagram = diagramValue?.trim() ? diagramValue : null;
  if (diagram && new TextEncoder().encode(diagram).length > MAX_SHARE_DOC) throw new HttpError(413, 'The diagram is too large to attach (at most 64 KB)');

  const files = form.getAll('screenshot').filter((f): f is File => typeof f !== 'string');
  if (files.length > MAX_FILES) throw new HttpError(400, `At most ${MAX_FILES} screenshots`);
  const images: { key: string; type: string; bytes: ArrayBuffer }[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE) throw new HttpError(413, 'A screenshot can be at most 5 MB');
    const bytes = await file.arrayBuffer();
    const type = sniffImage(new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)));
    if (!type) throw new HttpError(415, 'Screenshots must be PNG, JPEG or WebP images');
    images.push({ key: randomKey(), type, bytes });
  }
  const bucket = env.FEEDBACK_BUCKET;
  if (images.length && !bucket) throw new HttpError(503, 'Screenshots are not available right now; send the message without them');

  const version = env.CF_VERSION_METADATA;
  const context = {
    path: contextField(form, 'path', 300),
    userAgent: (request.headers.get('User-Agent') ?? '').slice(0, 400),
    viewport: contextField(form, 'viewport', 20),
    plan: user.plan,
    version: version ? { id: version.id, tag: version.tag || null, timestamp: version.timestamp } : null,
  };
  const id = crypto.randomUUID();
  // The screenshots go first, so a message never names one that is missing; if saving the message fails, they are removed again.
  for (const image of images) {
    await bucket!.put(image.key, image.bytes, { httpMetadata: { contentType: image.type }, customMetadata: { user: user.id, message: id } });
  }
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO feedback_messages (id, user_id, kind, subject, message, context, diagram, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        id,
        user.id,
        kind,
        subject || null,
        message,
        JSON.stringify(context),
        diagram,
        t,
        t,
      ),
      ...images.map((image, position) =>
        env.DB.prepare('INSERT INTO feedback_files (key, message_id, user_id, type, bytes, position) VALUES (?, ?, ?, ?, ?, ?)').bind(image.key, id, user.id, image.type, image.bytes.byteLength, position),
      ),
    ]);
  } catch (e) {
    if (images.length) await bucket!.delete(images.map((i) => i.key));
    throw e;
  }
  return json({ id }, 201, NO_STORE);
}

/** Deletes the account's screenshots from R2; call before the account's row goes (its cascade drops the keys). */
export async function deleteFeedbackFiles(env: Env, userId: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT key FROM feedback_files WHERE user_id = ?').bind(userId).all<{ key: string }>();
  if (!results.length) return;
  if (!env.FEEDBACK_BUCKET) throw new Error('FEEDBACK_BUCKET is not bound, so the screenshots cannot be deleted');
  for (let i = 0; i < results.length; i += 1000) await env.FEEDBACK_BUCKET.delete(results.slice(i, i + 1000).map((r) => r.key));
}

type MessageRow = {
  id: string;
  user_id: string;
  kind: Kind;
  subject: string | null;
  message: string;
  context: string;
  diagram: string | null;
  status: Status;
  note: string | null;
  created_at: number;
  read_at: number | null;
  updated_at: number;
};

/** The user's own messages for Download my data: never the operator's note. */
export async function exportFeedback(DB: D1Database, userId: string) {
  const [messages, files] = await DB.batch([
    DB.prepare('SELECT id, kind, subject, message, context, diagram, status, created_at FROM feedback_messages WHERE user_id = ? ORDER BY created_at, id').bind(userId),
    DB.prepare('SELECT message_id, type, bytes FROM feedback_files WHERE user_id = ? ORDER BY position').bind(userId),
  ]);
  const byMessage = new Map<string, { type: string; bytes: number }[]>();
  for (const f of files.results as { message_id: string; type: string; bytes: number }[]) {
    byMessage.set(f.message_id, [...(byMessage.get(f.message_id) ?? []), { type: f.type, bytes: f.bytes }]);
  }
  return (messages.results as MessageRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    message: r.message,
    context: JSON.parse(r.context) as unknown,
    diagram: r.diagram,
    status: r.status,
    createdAt: r.created_at,
    screenshots: byMessage.get(r.id) ?? [],
  }));
}

function offsetOf(url: URL): number {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000 ? offset : 0;
}

const contains = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** GET /api/admin/feedback?status=&kind=&q=&offset=: status `open` is new and in progress; q matches the subject, the message or the sender's account id. */
export async function listFeedback(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? '';
  const kind = url.searchParams.get('kind') ?? '';
  if (status && status !== 'open' && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'status must be new, in_progress, done or open');
  if (kind && !(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const offset = offsetOf(url);
  const where = `(?1 = '' OR (?1 = 'open' AND m.status <> 'done') OR m.status = ?1) AND (?2 = '' OR m.kind = ?2)
    AND (?3 = '' OR m.user_id = ?3 OR m.subject LIKE ?4 ESCAPE '\\' OR m.message LIKE ?4 ESCAPE '\\')`;
  const { DB } = ctx.env;
  const [rows, total, counts] = await DB.batch([
    DB.prepare(
      `SELECT m.id, m.kind, m.subject, substr(m.message, 1, 160) AS excerpt, m.status, m.created_at, m.read_at, m.diagram IS NOT NULL AS has_diagram,
         (SELECT COUNT(*) FROM feedback_files f WHERE f.message_id = m.id) AS files, m.user_id, u.display_name, u.blocked_at
       FROM feedback_messages m JOIN users u ON u.id = m.user_id WHERE ${where} ORDER BY m.created_at DESC, m.id LIMIT ${PAGE} OFFSET ${offset}`,
    ).bind(status, kind, q, contains(q)),
    DB.prepare(`SELECT COUNT(*) AS n FROM feedback_messages m WHERE ${where}`).bind(status, kind, q, contains(q)),
    DB.prepare(
      `SELECT COALESCE(SUM(read_at IS NULL), 0) AS unread, COALESCE(SUM(status = 'new'), 0) AS new, COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
         COALESCE(SUM(status = 'done'), 0) AS done FROM feedback_messages`,
    ),
  ]);
  type Row = { id: string; kind: Kind; subject: string | null; excerpt: string; status: Status; created_at: number; read_at: number | null; has_diagram: number; files: number; user_id: string; display_name: string; blocked_at: number | null };
  const c = counts.results[0] as { unread: number; new: number; in_progress: number; done: number };
  return json(
    {
      total: (total.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE,
      counts: { unread: c.unread, open: c.new + c.in_progress, new: c.new, inProgress: c.in_progress, done: c.done },
      messages: (rows.results as unknown as Row[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        subject: r.subject,
        excerpt: r.excerpt,
        status: r.status,
        createdAt: r.created_at,
        read: r.read_at !== null,
        hasDiagram: r.has_diagram === 1,
        screenshots: r.files,
        sender: { id: r.user_id, displayName: r.display_name, blocked: r.blocked_at !== null },
      })),
    },
    200,
    NO_STORE,
  );
}

async function findMessage(ctx: Ctx, id: string): Promise<MessageRow> {
  const row = ID.test(id) ? await ctx.env.DB.prepare('SELECT * FROM feedback_messages WHERE id = ?').bind(id).first<MessageRow>() : null;
  if (!row) throw new HttpError(404, 'No such message');
  return row;
}

/** GET /api/admin/feedback/<id>: the message, its sender with their contact address (when the account has one), and its screenshots; marks it read. */
export async function getFeedback(request: Request, ctx: Ctx, id: string): Promise<Response> {
  await requireAdmin(request, ctx);
  const row = await findMessage(ctx, id);
  const { DB } = ctx.env;
  const [sender, files] = await DB.batch([
    // A confirmed sign-in address first, then the one GitHub or Google verified, then a confirmed reminders address: where the user can be answered.
    DB.prepare(
      `SELECT u.display_name, u.blocked_at,
         COALESCE((SELECT email FROM email_logins WHERE user_id = u.id AND confirmed_at IS NOT NULL),
                  (SELECT email FROM contact_emails WHERE user_id = u.id),
                  (SELECT email FROM email_prefs WHERE user_id = u.id AND confirmed_at IS NOT NULL)) AS email
       FROM users u WHERE u.id = ?`,
    ).bind(row.user_id),
    DB.prepare('SELECT key, type, bytes FROM feedback_files WHERE message_id = ? ORDER BY position').bind(id),
    ...(row.read_at === null ? [DB.prepare('UPDATE feedback_messages SET read_at = ? WHERE id = ? AND read_at IS NULL').bind(now(), id)] : []),
  ]);
  const s = sender.results[0] as { display_name: string; blocked_at: number | null; email: string | null } | undefined;
  return json(
    {
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      message: row.message,
      context: JSON.parse(row.context) as unknown,
      diagram: row.diagram,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sender: { id: row.user_id, displayName: s?.display_name ?? '', blocked: (s?.blocked_at ?? null) !== null, email: s?.email ?? null },
      screenshots: (files.results as { key: string; type: string; bytes: number }[]).map((f) => ({ key: f.key, type: f.type, bytes: f.bytes })),
    },
    200,
    NO_STORE,
  );
}

/** PATCH /api/admin/feedback/<id> {status?, note?}: in the audit log with what changed (the note's length, not its text). */
export async function patchFeedback(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const row = await findMessage(ctx, id);
  const body = await readJson(request);
  const changed: Record<string, unknown> = {};
  let status = row.status;
  let note = row.note;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(STATUSES as readonly string[]).includes(body.status)) throw new HttpError(400, 'status must be new, in_progress or done');
    if (body.status !== row.status) changed.status = { from: row.status, to: body.status };
    status = body.status as Status;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') throw new HttpError(400, 'note must be text');
    const next = (body.note ?? '').trim();
    if (next.length > MAX_NOTE) throw new HttpError(400, `note is too long (at most ${MAX_NOTE.toLocaleString('en')} characters)`);
    if ((next || null) !== row.note) changed.note = { chars: next.length };
    note = next || null;
  }
  if (Object.keys(changed).length) {
    const { DB } = ctx.env;
    await DB.batch([
      DB.prepare('UPDATE feedback_messages SET status = ?, note = ?, updated_at = ? WHERE id = ?').bind(status, note, now(), id),
      auditStatement(ctx.env, admin, 'feedback.update', id, { ...changed, sender: row.user_id }),
    ]);
  }
  return json({ status, note }, 200, NO_STORE);
}

/** DELETE /api/admin/feedback/<id> {reason}: the message and its screenshots, with the reason in the audit log. */
export async function deleteFeedback(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const row = await findMessage(ctx, id);
  const body = await readJson(request);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';
  if (!reason) throw new HttpError(400, 'Give a reason: it goes in the audit log');
  const { DB } = ctx.env;
  const { results } = await DB.prepare('SELECT key FROM feedback_files WHERE message_id = ?').bind(id).all<{ key: string }>();
  if (results.length) {
    if (!ctx.env.FEEDBACK_BUCKET) throw new HttpError(503, 'FEEDBACK_BUCKET is not bound, so the screenshots cannot be deleted');
    await ctx.env.FEEDBACK_BUCKET.delete(results.map((r) => r.key));
  }
  await DB.batch([
    DB.prepare('DELETE FROM feedback_messages WHERE id = ?').bind(id),
    auditStatement(ctx.env, admin, 'feedback.delete', id, { reason, sender: row.user_id, kind: row.kind }),
  ]);
  return new Response(null, { status: 204 });
}

/** GET /api/admin/feedback/<id>/files/<key>: one screenshot, with the type it was checked to be, never cached. */
export async function getFeedbackFile(request: Request, ctx: Ctx, id: string, key: string): Promise<Response> {
  await requireAdmin(request, ctx);
  const row =
    ID.test(id) && KEY.test(key)
      ? await ctx.env.DB.prepare('SELECT type FROM feedback_files WHERE key = ? AND message_id = ?').bind(key, id).first<{ type: string }>()
      : null;
  const object = row ? await ctx.env.FEEDBACK_BUCKET?.get(key) : null;
  if (!row || !object) throw new HttpError(404, 'No such screenshot');
  return new Response(object.body, {
    headers: { 'Content-Type': row.type, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store' },
  });
}
