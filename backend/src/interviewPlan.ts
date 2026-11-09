import { MAX_DAYS, readPlanSettings, type PlanSettings } from '../../frontend/src/learn/interviewPlan';
import { daysBetween, isDay } from '../../frontend/src/learn/review';
import { requireUser, type User } from './auth';
import type { Ctx } from './context';
import { requireFeature } from './features';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';

/**
 * The interview-date plan (interview_plan, Max; docs/design/paid-plans.md
 * P54): the browser builds the schedule (frontend/src/learn/interviewPlan.ts);
 * the account keeps the date and minutes, so every device shows the same
 * plan, and today's list as last built, so the evening reminder can name
 * what is left (src/reminders.ts). Migration 0034.
 *
 *   GET    /api/me/interview-plan   {plan: {date, minutes, start} | null}: Max (402 plan_required)
 *   PUT    /api/me/interview-plan {date, minutes, start, today?: {day, items: [{title, done}]}}: Max
 *   DELETE /api/me/interview-plan   removes it: any plan, so a downgraded account can still clear it
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
/** Today's list: at most this many items, each title at most this long. */
export const MAX_TODAY_ITEMS = 8;
const MAX_TITLE = 120;

export interface TodayItem {
  title: string;
  done: boolean;
}

interface PlanRow {
  interview_date: string;
  minutes: number;
  start_day: string;
  today_day: string | null;
  today_items: string | null;
}

/** Today's list from a request, or undefined when it is malformed. */
function readToday(raw: unknown): { day: string; items: TodayItem[] } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { day, items } = raw as Record<string, unknown>;
  if (!isDay(day) || !Array.isArray(items) || items.length > MAX_TODAY_ITEMS) return undefined;
  const list: TodayItem[] = [];
  for (const i of items) {
    const { title, done } = (i ?? {}) as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE || typeof done !== 'boolean') return undefined;
    list.push({ title: title.trim(), done });
  }
  return { day, items: list };
}

const settingsOf = (row: PlanRow | null): PlanSettings | null => (row ? { date: row.interview_date, minutes: row.minutes, start: row.start_day } : null);

/** The account's plan with today's list, for the reminders. */
export async function readPlan(DB: D1Database, userId: string) {
  return DB.prepare('SELECT interview_date, minutes, start_day, today_day, today_items FROM interview_plans WHERE user_id = ?').bind(userId).first<PlanRow>();
}

/** Today's list as kept (`today_items`), [] when unreadable. */
export function todayItems(raw: string | null): TodayItem[] {
  if (!raw) return [];
  try {
    return readToday({ day: '2000-01-01', items: JSON.parse(raw) })?.items ?? [];
  } catch {
    return [];
  }
}

/** GET /api/me/interview-plan */
export const getInterviewPlan = requireFeature('interview_plan', async (_request: Request, ctx: Ctx, user: User): Promise<Response> => {
  return json({ plan: settingsOf(await readPlan(ctx.env.DB, user.id)) }, 200, NO_STORE);
});

/**
 * PUT /api/me/interview-plan: sets the date and minutes, and today's list
 * when given. The date must be from yesterday to MAX_DAYS + 1 days ahead by
 * the server's (UTC) calendar: the browser's may be a day off it, and the
 * interview day itself still sends its list.
 */
export const putInterviewPlan = requireFeature('interview_plan', async (request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const { DB } = ctx.env;
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many changes; wait a minute');
  const body = await readJson(request, 4096);
  const settings = readPlanSettings(body);
  if (!settings) throw new HttpError(400, 'date and start must be YYYY-MM-DD, start not after date, and minutes a whole number from 15 to 240');
  const ahead = daysBetween(new Date(now() * 1000).toISOString().slice(0, 10), settings.date);
  if (ahead < -1 || ahead > MAX_DAYS + 1) throw new HttpError(400, `date must be in the next ${MAX_DAYS} days`);
  const today = body.today === undefined ? undefined : readToday(body.today);
  if (body.today !== undefined && !today) throw new HttpError(400, `today must be {day, items}: at most ${MAX_TODAY_ITEMS} items of {title, done}`);
  await DB.prepare(
    `INSERT INTO interview_plans (user_id, interview_date, minutes, start_day, today_day, today_items, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (user_id) DO UPDATE SET interview_date = ?2, minutes = ?3, start_day = ?4,
       today_day = COALESCE(?5, today_day), today_items = COALESCE(?6, today_items), updated_at = ?7`,
  )
    .bind(user.id, settings.date, settings.minutes, settings.start, today?.day ?? null, today ? JSON.stringify(today.items) : null, now())
    .run();
  return json({ plan: settings }, 200, NO_STORE);
});

/** DELETE /api/me/interview-plan */
export async function deleteInterviewPlan(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await ctx.env.DB.prepare('DELETE FROM interview_plans WHERE user_id = ?').bind(user.id).run();
  return new Response(null, { status: 204 });
}

/** The plan in "Download my data". */
export async function exportInterviewPlan(DB: D1Database, userId: string) {
  const row = await readPlan(DB, userId);
  return row ? { ...settingsOf(row), todayDay: row.today_day, today: todayItems(row.today_items) } : null;
}
