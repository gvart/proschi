// `METRICS_TOKEN=… node scripts/metrics.mjs [base URL] [days]`: prints the
// usage counts (GET /api/metrics/summary, README "Usage counts") as an
// activation funnel and a per-day table. Base URL defaults to
// https://proschi.app, days to 30.
const base = (process.argv[2] ?? 'https://proschi.app').replace(/\/$/, '');
const days = Number(process.argv[3] ?? 30);
const token = process.env.METRICS_TOKEN;
if (!/^https?:\/\//.test(base) || !Number.isInteger(days) || !token) {
  console.error('Usage: METRICS_TOKEN=<secret> node scripts/metrics.mjs [base URL] [days]');
  process.exit(2);
}

const response = await fetch(`${base}/api/metrics/summary?days=${days}`, { headers: { 'X-Metrics-Token': token } });
if (response.status === 404) {
  console.error('404: METRICS_TOKEN is not set on the Worker, or the token is wrong.');
  process.exit(1);
}
if (!response.ok) {
  console.error(`${response.status}: ${await response.text()}`);
  process.exit(1);
}
const summary = await response.json();

// The activation funnel, in order; each step as a share of the first.
const FUNNEL = [
  ['landing_view', 'Landing page viewed'],
  ['editor_open', 'Editor opened'],
  ['editor_first_edit', 'First edit (once per browser)'],
  ['simulation_run', 'Traffic/analysis viewed'],
  ['share_link_created', 'Share link created'],
  ['export', 'Exported'],
  ['practice_open', 'Practice opened'],
  ['problem_start', 'Problem started'],
  ['test_run', 'Tests run'],
  ['problem_solve', 'Problem solved (first time)'],
  ['sign_in', 'Signed in'],
  ['card_review_session', 'Card review session finished'],
  ['challenge_complete', 'Daily challenge finished'],
  ['arcade_run_start', 'Arcade run started'],
  ['arcade_run_end', 'Arcade run finished'],
];

const pad = (text, n) => String(text).padEnd(n);
const lpad = (text, n) => String(text).padStart(n);
const first = summary.totals[FUNNEL[0][0]] || 0;

console.log(`Usage counts ${summary.from} – ${summary.to} (UTC days)\n`);
console.log(`${pad('Step', 34)}${lpad('Count', 9)}${lpad('of landing', 12)}`);
for (const [event, label] of FUNNEL) {
  const n = summary.totals[event] ?? 0;
  console.log(`${pad(label, 34)}${lpad(n, 9)}${lpad(first ? `${((100 * n) / first).toFixed(1)}%` : '–', 12)}`);
}
for (const event of summary.events) {
  if (!FUNNEL.some(([e]) => e === event)) console.log(`${pad(event, 34)}${lpad(summary.totals[event] ?? 0, 9)}`);
}

const columns = ['landing_view', 'editor_open', 'practice_open', 'test_run', 'problem_solve', 'sign_in'];
console.log(`\n${pad('Day', 12)}${columns.map((c) => lpad(c, 15)).join('')}`);
for (const { day, counts } of summary.days) {
  console.log(`${pad(day, 12)}${columns.map((c) => lpad(counts[c] ?? 0, 15)).join('')}`);
}
