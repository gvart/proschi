import type { Achievement } from '../../frontend/src/learn/achievements';
import raw from '../../frontend/src/practice/achievements.json';
import type { Ctx } from './context';
import { sha256 } from './crypto';
import { rateLimit } from './http';
import { errorText, log } from './log';
import { renderProfileCard, type ProfileCard } from './og';
import { loadPublicProfile, type PublicProfile } from './profile';
import { findProblem, problemIds } from './verify';

/**
 * Public profiles at real addresses, for links people share:
 *
 *   GET /u/<id>      the practice page with the profile's title, description,
 *                    canonical address and Open Graph image in its <head>
 *                    (and a plain summary for crawlers in its body); the page
 *                    then shows the profile, `#/u/<id>` (src/practice/main.tsx)
 *   GET /u/<id>.png  the profile's Open Graph card (src/og.ts)
 *
 * Only for a user who opted in (`public_profile`, the same as the JSON
 * profile, src/profile.ts); anyone else's address is 404, the same as an id
 * nobody has. `#/u/<id>` on the practice page keeps working.
 */

const BADGES = new Map((raw as unknown as Achievement[]).map((a) => [a.id, a.title]));

/** The ids user profiles have (UUIDs), and what /u/ accepts. */
const PATH = /^\/u\/([A-Za-z0-9-]{1,64})(\.png)?\/?$/;

/** Bump to draw every profile card again (a new layout). */
const CARD_VERSION = 1;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the card shows; its hash names the image, so a new solve or badge is a new image. */
export function profileCard(profile: PublicProfile): ProfileCard {
  return {
    displayName: profile.displayName,
    solved: profile.solved.length,
    problems: problemIds().length,
    streak: profile.streak.current,
    badges: profile.badges.length,
    readiness: profile.readiness,
  };
}

async function cardHash(card: ProfileCard): Promise<string> {
  return (await sha256(JSON.stringify([CARD_VERSION, card]))).slice(0, 16);
}

/** The description of the profile: in the page's meta tags and its summary. */
export function profileDescription(profile: PublicProfile): string {
  const parts = [`Solved ${profile.solved.length} of ${problemIds().length} system design problems`];
  if (profile.badges.length) parts.push(plural(profile.badges.length, 'badge'));
  if (profile.streak.current > 0) parts.push(`${profile.streak.current}-day streak`);
  return `${parts.join(' · ')} on Proschi, the system design practice site with automatic tests.`;
}

interface Meta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

function headTags(meta: Meta): string {
  const m = {
    title: escapeHtml(meta.title),
    description: escapeHtml(meta.description),
    url: escapeHtml(meta.url),
    image: escapeHtml(meta.image),
    imageAlt: escapeHtml(meta.imageAlt),
  };
  return [
    `<title>${m.title}</title>`,
    `<meta name="description" content="${m.description}" />`,
    `<link rel="canonical" href="${m.url}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="Proschi" />`,
    `<meta property="og:title" content="${m.title}" />`,
    `<meta property="og:description" content="${m.description}" />`,
    `<meta property="og:url" content="${m.url}" />`,
    `<meta property="og:image" content="${m.image}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${m.imageAlt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}

/** The profile as plain HTML, for crawlers and before the page's script runs; the page replaces it. */
function summaryHtml(profile: PublicProfile, description: string): string {
  const problems = profile.solved.map((s) => findProblem(s.id)?.title ?? s.id);
  const badges = profile.badges.map((b) => BADGES.get(b.id) ?? b.id);
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return [
    `<main class="profile-summary">`,
    `<h1>${escapeHtml(profile.displayName)}</h1>`,
    `<p>${escapeHtml(description)}</p>`,
    problems.length ? `<h2>Problems solved</h2>${list(problems)}` : '',
    badges.length ? `<h2>Badges</h2>${list(badges)}` : '',
    `<p><a href="/practice/#/u/${encodeURIComponent(profile.id)}">Open the profile</a></p>`,
    `</main>`,
  ].join('');
}

/** The response headers of the site's pages (frontend/public/_headers), which the API's do not suit. */
function pageHeaders(contentType: string, extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "frame-ancestors 'none'",
    ...extra,
  });
}

/** A page of its own when the built practice page is not there (the Worker's tests, a broken deploy). */
function standalonePage(head: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${head}
    <style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;background:#F4F1EA;color:#1C1917}a{color:#C2410C}</style>
  </head>
  <body>${body}</body>
</html>
`;
}

const TAGS_TO_REPLACE = ['title', 'meta[name="description"]', 'link[rel="canonical"]', 'meta[name="robots"]', 'meta[property^="og:"]', 'meta[name^="twitter:"]'];

/**
 * The built practice page with the profile's head and summary: its scripts
 * and styles are relative to /practice/, so a <base> points them there.
 */
export function rewritePracticePage(page: Response, head: string, summary: string, headers: Headers): Response {
  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.prepend('<base href="/practice/" />', { html: true });
        el.append(`${head}\n`, { html: true });
      },
    })
    .on('div#root', {
      element(el) {
        el.setInnerContent(summary, { html: true });
      },
    });
  for (const selector of TAGS_TO_REPLACE) rewriter.on(selector, { element: (el) => void el.remove() });
  return rewriter.transform(new Response(page.body, { status: 200, headers }));
}

async function notFoundPage(request: Request, ctx: Ctx): Promise<Response> {
  const headers = pageHeaders('text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  try {
    const page = await ctx.env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
    if (page.ok) return new Response(page.body, { status: 404, headers });
  } catch {
    // The built site is not there; the plain page below will do.
  }
  return new Response(standalonePage('<title>Not found · Proschi</title>', '<h1>Not found</h1><p><a href="/practice/">System design practice</a></p>'), { status: 404, headers });
}

/** GET or HEAD /u/<id> and /u/<id>.png; any other method or path under /u is 404. */
export async function servePublicProfile(request: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (!match || (request.method !== 'GET' && request.method !== 'HEAD')) return notFoundPage(request, ctx);
  const [, id, png] = match;
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const profile = await loadPublicProfile(ctx.env, id);
  if (!profile) return notFoundPage(request, ctx);
  const card = profileCard(profile);
  const hash = await cardHash(card);
  return png ? profileImage(request, ctx, id, card, hash) : profilePage(request, ctx, profile, hash);
}

async function profilePage(request: Request, ctx: Ctx, profile: PublicProfile, hash: string): Promise<Response> {
  const origin = new URL(request.url).origin;
  const path = `/u/${encodeURIComponent(profile.id)}`;
  const description = profileDescription(profile);
  const head = headTags({
    title: `${profile.displayName} on Proschi`,
    description,
    url: `${origin}${path}`,
    image: `${origin}${path}.png?v=${hash}`,
    imageAlt: `${profile.displayName} on Proschi: ${profile.solved.length} problems solved, ${plural(profile.badges.length, 'badge')}`,
  });
  const summary = summaryHtml(profile, description);
  // Not cached: turning the profile off must take effect at once.
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

/** Rendered images, kept in this data centre's cache under the card's hash (the URL is never seen by clients). */
const cacheKey = (origin: string, id: string, hash: string) => new Request(`${origin}/u/${encodeURIComponent(id)}.png?card=${hash}`);

async function profileImage(request: Request, ctx: Ctx, id: string, card: ProfileCard, hash: string): Promise<Response> {
  // Revalidated every time (ETag), so an image stops being served as soon as the profile is turned off.
  const etag = `"${hash}"`;
  const headers = pageHeaders('image/png', { 'Cache-Control': 'public, no-cache', ETag: etag, 'Cross-Origin-Resource-Policy': 'cross-origin' });
  if ((request.headers.get('If-None-Match') ?? '').split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers });

  const key = cacheKey(new URL(request.url).origin, id, hash);
  const cache = await caches.open('og');
  const hit = await cache.match(key);
  if (hit) return new Response(request.method === 'HEAD' ? null : hit.body, { status: 200, headers });

  let png: Uint8Array;
  try {
    png = await renderProfileCard(card);
  } catch (e) {
    // The site's own image instead of none; the next request tries again.
    log('error', 'Profile card failed to render', { requestId: ctx.requestId, error: errorText(e) });
    return Response.redirect(new URL('/og.png', request.url).toString(), 302);
  }
  ctx.exec.waitUntil(cache.put(key, new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } })));
  return new Response(request.method === 'HEAD' ? null : png, { status: 200, headers });
}
