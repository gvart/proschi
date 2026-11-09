import { requireUser } from './auth';
import type { Ctx } from './context';
import { randomToken, sha256 } from './crypto';
import { now, type Env } from './env';
import { can, planRequired } from './features';
import { HttpError, json, rateLimit, readJson } from './http';
import { renderCertificateCard, type CertificateCard } from './og';
import { effectivePlan } from './plans';
import { escapeHtml, headTags, notFoundPage, pageHeaders, rewritePracticePage, serveCardImage, standalonePage } from './profilePage';
import { learningSummary } from './progressExport';
import { catalogSolved } from './verify';

/**
 * The mastery certificate (Max, `certificate`; docs/design/paid-plans.md
 * P56) and the embed branding switch (Pro, `pro_exports`):
 *
 *   GET  /api/me/certificate               {certificate: {id, public, issuedAt} | null}
 *   PUT  /api/me/certificate {public}      turns it on (Max, 402 otherwise) or off (any plan)
 *   GET  /api/certificates/<id>            the certificate, public: 404 when off, the plan lacks it or no such id
 *   GET  /c/<id>                           the practice page with its meta tags, showing `#/c/<id>`
 *   GET  /c/<id>.png                       its Open Graph card (src/og.ts)
 *   GET  /api/me/embeds                    {branding}
 *   PUT  /api/me/embeds {branding}         false hides Proschi's branding on the account's embeds (Pro, 402 otherwise)
 *
 * A certificate is drawn from the account's own data at each visit (level,
 * mastery per skill, problems solved), never from what a request carries, so
 * nobody can make one say what the account has not done. Its id is random
 * and stays the same when it is turned off and on again.
 */

/** randomToken(9): 12 base64url characters. */
const ID = /^[A-Za-z0-9_-]{12}$/;
const PATH = /^\/c\/([A-Za-z0-9_-]{12})(\.png)?\/?$/;
/** Bump to draw every certificate card again (a new layout). */
const CARD_VERSION = 1;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET /api/certificates/<id>'s answer. Times are Unix seconds. */
export interface PublicCertificate {
  id: string;
  displayName: string;
  issuedAt: number;
  /** When the numbers were read: now. */
  asOf: number;
  level: number;
  xp: number;
  /** 0 to 1, rounded to whole percent. */
  readiness: number;
  problems: number;
  solved: { id: string; title: string; difficulty: string }[];
  /** Every skill of the skill map, strongest first, 0 to 1 rounded to whole percent. */
  skills: { topic: string; title: string; mastery: number }[];
  streak: { longest: number };
}

const share = (n: number) => Math.round(n * 100) / 100;

/** The certificate `id` when its owner shows it and their plan has it; null otherwise, the same for an id nobody has. */
export async function loadCertificate(env: Env, id: string): Promise<PublicCertificate | null> {
  if (!ID.test(id)) return null;
  const row = await env.DB.prepare(
    `SELECT c.id, c.issued_at, u.id AS user_id, u.display_name, u.daily_goal, u.plan, u.comp_until
     FROM certificates c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.public = 1 AND u.blocked_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; issued_at: number; user_id: string; display_name: string; daily_goal: number; plan: string; comp_until: number | null }>();
  if (!row || !can({ plan: effectivePlan(row.plan, row.comp_until) }, 'certificate', env).ok) return null;
  const summary = await learningSummary(env, { id: row.user_id, dailyGoal: row.daily_goal });
  const catalog = catalogSolved(
    (await env.DB.prepare('SELECT problem_id FROM progress WHERE user_id = ? AND solved_at IS NOT NULL').bind(row.user_id).all<{ problem_id: string }>()).results.map(
      (r) => r.problem_id,
    ),
  );
  return {
    id: row.id,
    displayName: row.display_name,
    issuedAt: row.issued_at,
    asOf: now(),
    level: summary.level.level,
    xp: summary.level.xp,
    readiness: share(summary.readiness),
    problems: catalog.total,
    solved: catalog.solved,
    skills: summary.topics.map((t) => ({ ...t, mastery: share(t.mastery) })).sort((a, b) => b.mastery - a.mastery),
    streak: { longest: summary.streak.longest },
  };
}

/** GET /api/certificates/<id>: not cached, so turning it off takes effect at once. */
export async function getCertificate(ctx: Ctx, id: string): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const body = await loadCertificate(ctx.env, id);
  if (!body) throw new HttpError(404, 'No such certificate');
  return json(body, 200, NO_STORE);
}

type Mine = { id: string; public: boolean; issuedAt: number };

async function mine(env: Env, userId: string): Promise<Mine | null> {
  const row = await env.DB.prepare('SELECT id, public, issued_at FROM certificates WHERE user_id = ?').bind(userId).first<{ id: string; public: number; issued_at: number }>();
  return row ? { id: row.id, public: row.public === 1, issuedAt: row.issued_at } : null;
}

/** GET /api/me/certificate: the account's certificate, on or off; null before the first. */
export async function getMyCertificate(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  return json({ certificate: await mine(ctx.env, user.id) }, 200, NO_STORE);
}

/** PUT /api/me/certificate {public}: on needs Max; off is open to every plan, so a downgraded account can still hide it. */
export async function putMyCertificate(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request);
  if (typeof body.public !== 'boolean') throw new HttpError(400, 'public must be true or false');
  if (body.public) {
    if (!can(user, 'certificate', ctx.env).ok) return planRequired('certificate');
    await ctx.env.DB.prepare('INSERT INTO certificates (id, user_id, public, issued_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_id) DO UPDATE SET public = 1')
      .bind(randomToken(9), user.id, now())
      .run();
  } else {
    await ctx.env.DB.prepare('UPDATE certificates SET public = 0 WHERE user_id = ?').bind(user.id).run();
  }
  return json({ certificate: await mine(ctx.env, user.id) }, 200, NO_STORE);
}

/** GET /api/me/embeds: whether the account's embeds show Proschi's branding. */
export async function getEmbeds(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const row = await ctx.env.DB.prepare('SELECT embed_branding FROM users WHERE id = ?').bind(user.id).first<{ embed_branding: number }>();
  return json({ branding: row?.embed_branding !== 0 }, 200, NO_STORE);
}

/** PUT /api/me/embeds {branding}: hiding it needs Pro; showing it again is open to every plan. */
export async function putEmbeds(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request);
  if (typeof body.branding !== 'boolean') throw new HttpError(400, 'branding must be true or false');
  if (!body.branding && !can(user, 'pro_exports', ctx.env).ok) return planRequired('pro_exports');
  await ctx.env.DB.prepare('UPDATE users SET embed_branding = ? WHERE id = ?').bind(body.branding ? 1 : 0, user.id).run();
  return json({ branding: body.branding }, 200, NO_STORE);
}

/** For the full export (GET /api/me/export). */
export async function exportCertificate(env: Env, userId: string): Promise<{ certificate: Mine | null; embedBranding: boolean }> {
  const row = await env.DB.prepare('SELECT embed_branding FROM users WHERE id = ?').bind(userId).first<{ embed_branding: number }>();
  return { certificate: await mine(env, userId), embedBranding: row?.embed_branding !== 0 };
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const issuedText = (seconds: number) => MONTH.format(new Date(seconds * 1000));

export function certificateCard(cert: PublicCertificate, host: string): CertificateCard {
  return {
    displayName: cert.displayName,
    level: cert.level,
    solved: cert.solved.length,
    problems: cert.problems,
    readiness: cert.readiness,
    skills: cert.skills.slice(0, 4).map((s) => ({ title: s.title, mastery: s.mastery })),
    issued: issuedText(cert.issuedAt),
    address: `${host}/c/${cert.id}`,
  };
}

export function certificateDescription(cert: PublicCertificate): string {
  return `Level ${cert.level} · ${cert.solved.length} of ${cert.problems} system design problems solved · ${Math.round(cert.readiness * 100)}% interview ready. A Proschi mastery certificate, drawn from progress on proschi.app, issued ${issuedText(cert.issuedAt)}.`;
}

/** The certificate as plain HTML, for crawlers and before the page's script runs; the page replaces it. */
function summaryHtml(cert: PublicCertificate, description: string): string {
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return [
    `<main class="certificate-summary">`,
    `<h1>${escapeHtml(cert.displayName)}: Proschi mastery certificate</h1>`,
    `<p>${escapeHtml(description)}</p>`,
    `<h2>Skills</h2>${list(cert.skills.map((s) => `${s.title}: ${Math.round(s.mastery * 100)}%`))}`,
    cert.solved.length ? `<h2>Problems solved</h2>${list(cert.solved.map((s) => s.title))}` : '',
    `<p><a href="/practice/#/c/${encodeURIComponent(cert.id)}">Open the certificate</a></p>`,
    `</main>`,
  ].join('');
}

/** GET or HEAD /c/<id> and /c/<id>.png; any other method or path under /c is 404. */
export async function serveCertificate(request: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match || (request.method !== 'GET' && request.method !== 'HEAD')) return notFoundPage(request, ctx);
  const [, id, png] = match;
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const cert = await loadCertificate(ctx.env, id);
  if (!cert) return notFoundPage(request, ctx);
  const card = certificateCard(cert, url.host);
  const hash = (await sha256(JSON.stringify([CARD_VERSION, card]))).slice(0, 16);
  const path = `/c/${cert.id}`;
  if (png) return serveCardImage(request, ctx, path, hash, () => renderCertificateCard(card));

  const description = certificateDescription(cert);
  const head = headTags({
    type: 'website',
    title: `${cert.displayName}: Proschi mastery certificate`,
    description,
    url: `${url.origin}${path}`,
    image: `${url.origin}${path}.png?v=${hash}`,
    imageAlt: `${cert.displayName}'s Proschi mastery certificate: level ${cert.level}, ${cert.solved.length} problems solved`,
  });
  const summary = summaryHtml(cert, description);
  // Not cached: turning the certificate off must take effect at once.
  const headers = pageHeaders('text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  try {
    const page = await ctx.env.ASSETS.fetch(new Request(new URL('/practice/', request.url)));
    if (page.ok && (page.headers.get('Content-Type') ?? '').includes('text/html')) return rewritePracticePage(page, head, summary, headers);
  } catch {
    // The built site is not there; the page below says the same.
  }
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  return new Response(standalonePage(head, summary), { status: 200, headers });
}
