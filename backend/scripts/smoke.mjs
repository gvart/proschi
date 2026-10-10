// `node scripts/smoke.mjs <base URL>`: checks a deployed Worker answers, e.g.
// https://staging.proschi.app after `npm run deploy:staging`. Exits 1 on a failure.
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/smoke.mjs <base URL>');
  process.exit(2);
}

const SECURITY_HEADERS = ['x-request-id', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security'];
// The static site's, from frontend/public/_headers.
const STATIC_HEADERS = ['x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security'];
let failed = false;

async function check(path, status, test = () => undefined, headers = SECURITY_HEADERS) {
  let problem;
  try {
    const response = await fetch(`${base}${path}`, { redirect: 'manual' });
    const body = await response.text();
    const missing = headers.filter((h) => !response.headers.has(h));
    if (response.status !== status) problem = `status ${response.status}, expected ${status}: ${body.slice(0, 200)}`;
    else if (missing.length) problem = `missing headers: ${missing.join(', ')}`;
    else problem = test(body.startsWith('{') ? JSON.parse(body) : body);
  } catch (e) {
    problem = String(e);
  }
  console.log(`${problem ? 'FAIL' : 'ok  '} GET ${path}${problem ? `: ${problem}` : ''}`);
  if (problem) failed = true;
}

await check('/api/health', 200, (body) => (body.ok === true ? undefined : `body ${JSON.stringify(body)}`));
await check('/auth/providers', 200, (body) => (Array.isArray(body.providers) ? undefined : 'no providers list'));
await check('/api/stats', 200, (body) => (body.problems ? undefined : 'no problems'));
await check('/api/me', 401);
await check('/api/admin/users', 401);
await check('/admin/', 200, (body) => (body.includes('noindex') ? undefined : 'not the admin page'), STATIC_HEADERS);
await check('/', 200, (body) => (/<title>[^<]*Proschi<\/title>/.test(body) && body.includes('rel="canonical" href="https://proschi.app/"') ? undefined : 'not the landing page'), STATIC_HEADERS);
await check('/no-such-page/', 404, (body) => (body.includes('Page not found') ? undefined : 'not the 404 page'), STATIC_HEADERS);
await check('/practice/url-shortener/', 200, (body) => (body.includes('application/ld+json') ? undefined : 'no structured data'), STATIC_HEADERS);
await check('/sitemap.xml', 200, (body) => (body.includes('<urlset') ? undefined : 'not a sitemap'), STATIC_HEADERS);
await check('/robots.txt', 200, (body) => (body.includes('Sitemap:') ? undefined : 'no Sitemap line'), STATIC_HEADERS);
process.exit(failed ? 1 : 0);
