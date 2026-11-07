// `node scripts/partner-smoke.mjs [base URL]`: runs Design partner against the REAL Claude API
// once per main intent (review, build, and solve on a practice problem), through a local
// Worker (`npm run dev`, default http://localhost:8787) whose .dev.vars has ANTHROPIC_API_KEY.
// It spends real money (a few cents) and is never run in CI.
//
// It makes a throwaway account in the LOCAL D1 only (wrangler d1 execute --local), signs in as
// it with a session cookie, and prints each turn's status, changes and credits. The Worker logs
// each turn's token usage (`partner.turn`), from which the cost can be read.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error('Refused: this smoke runs only against a local Worker (http://localhost:<port>).');
  process.exit(2);
}

const id = randomUUID();
const token = `smoke-${randomUUID()}`;
const hash = createHash('sha256').update(token).digest('base64url');
const sql = `INSERT INTO users (id, display_name, public_profile, created_at) VALUES ('${id}', 'Partner smoke', 0, 0);
INSERT INTO identities (provider, subject, user_id) VALUES ('github', 'smoke-${id}', '${id}');
INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${hash}', '${id}', 4000000000, 0);`;
execFileSync('npx', ['wrangler', 'd1', 'execute', 'proschi', '--local', '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });

const headers = { 'Content-Type': 'application/json', Origin: base, Cookie: `__Host-proschi_session=${token}` };
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text };
}

const SHOP = `title "Shop"

user "Shopper"  [Browser]
api  "Shop API" [REST API]
db   "Orders"   [PostgreSQL]

user -> api : HTTPS
api  -> db  : SQL

usecase "Order" {
  user -> api : POST /orders
  api  -> db  : INSERT order
  api --> user : 201
}

traffic {
  "Order" 2k rps
}

requirements {
  p99 "Order" < 200ms
  availability >= 99.9%
  survive any node failure
}
`;

const STARTER = `import "problem.proschi"

# Add the components, connections and the use cases "Shorten" and "Redirect".
api "Shortener API" [REST API]

visitor -> api

usecase "Shorten" {
  visitor -> api : POST /links json {"target": "https://example.com/a/long/path"}
  api --> visitor : 201 {"code": "aZ3x9"}
}
`;

let failed = false;
async function run(label, context, turn) {
  const started = Date.now();
  const s = await api('POST', '/api/partner/sessions', { context });
  if (s.status !== 201) {
    console.log(`FAIL ${label}: session ${s.status} ${JSON.stringify(s.body)}`);
    failed = true;
    return;
  }
  const t = await api('POST', `/api/partner/sessions/${s.body.id}/turns`, turn);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (t.status !== 200) {
    console.log(`FAIL ${label} (${secs} s): ${t.status} ${JSON.stringify(t.body)}`);
    failed = true;
    return;
  }
  const { turn: answer, credits } = t.body;
  const changes = answer.changes ?? [];
  console.log(`ok   ${label} (${secs} s): ${changes.length} changes, ${changes.filter((c) => c.result.ok).length} applied, ${answer.questions?.length ?? 0} questions, assisted ${!!answer.assisted}, credits ${JSON.stringify(credits)}`);
  for (const c of changes) {
    console.log(`     - ${c.title}: ${c.result.ok ? `tests ${JSON.stringify(c.result.before.tests)} -> ${JSON.stringify(c.result.after.tests)}, p99 ${c.result.before.p99Ms} -> ${c.result.after.p99Ms} ms, $${c.result.before.costPerMonth} -> $${c.result.after.costPerMonth}; ${c.result.summary.join('; ')}` : `FAILED ${c.result.reason}`}`);
  }
  console.log(`     ${answer.message.slice(0, 300).replace(/\n/g, ' ')}${answer.message.length > 300 ? '…' : ''}`);
}

await run('review', { kind: 'editor' }, { intent: 'review', message: '', source: SHOP });
await run('build', { kind: 'editor' }, { intent: 'build', message: 'A photo sharing app: users upload photos, follow others and scroll a feed of the people they follow. 50k feed reads a second, 500 uploads a second.', source: '' });
await run('solve', { kind: 'practice', problemId: 'url-shortener' }, { intent: 'solve', message: 'Show me a design that passes every test.', source: STARTER });
process.exit(failed ? 1 : 0);
