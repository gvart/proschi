import { GUIDES } from '../../frontend/src/practice/guide/guides';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { findProblem } from './verify';

/**
 * Lessons and roadmap guides read (migrations/0014_lesson_reads.sql): the
 * practice page sends a read when the end of a lesson comes into view or its
 * challenge is started, and on sign-in the reads the account lacks. GET
 * /api/me answers them all, so the roadmap shows them on every device.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

/** A problem (whose lesson the Worker does not bundle, scripts/problems.mjs) or a guide. */
export function isLessonId(id: string): boolean {
  return GUIDES.some((g) => g.id === id) || findProblem(id) !== undefined;
}

/** At most this many ids in one request: every lesson and guide, with room to grow. */
export const MAX_LESSON_IDS = 200;

/** The user's lessons and guides read, sorted. */
export async function loadLessonsRead(DB: D1Database, userId: string): Promise<string[]> {
  const rows = await DB.prepare('SELECT lesson_id FROM lesson_reads WHERE user_id = ? ORDER BY lesson_id').bind(userId).all<{ lesson_id: string }>();
  return rows.results.map((r) => r.lesson_id);
}

/**
 * POST /api/me/lessons {ids}: marks lessons (problem ids) and guides (guide
 * ids) as read. Ids that name neither are skipped, so a page built before a
 * lesson was renamed still saves the rest. Answers `{added, skipped}`.
 */
export async function postLessonsRead(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const body = await readJson(request);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_LESSON_IDS || !ids.every((id) => typeof id === 'string' && id.length <= 100)) {
    throw new HttpError(400, `ids must be a list of 1 to ${MAX_LESSON_IDS} lesson ids`);
  }
  await rateLimit(ctx.env.STATS_LIMITER, `lessons:${user.id}`, 'Too many requests; wait a minute');
  const unique = [...new Set(ids as string[])];
  const valid = unique.filter(isLessonId);
  const skipped = unique.filter((id) => !isLessonId(id));
  let added = 0;
  if (valid.length) {
    // A read already stored keeps its first time.
    const result = await ctx.env.DB.prepare('INSERT OR IGNORE INTO lesson_reads (user_id, lesson_id, read_at) SELECT ?1, value, ?2 FROM json_each(?3)')
      .bind(user.id, now(), JSON.stringify(valid))
      .run();
    added = result.meta.changes ?? 0;
  }
  return json({ added, skipped }, 200, NO_STORE);
}
