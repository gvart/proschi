// `npm run backup` (and so `npm run deploy`, before migrating): prints the D1
// Time Travel bookmark of the database as it is now, and how to restore it.
// D1 keeps 30 days of history on its own; the bookmark marks the moment
// before the deploy. In GitHub Actions it is also the step output `bookmark`.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const database = process.argv[2] ?? 'proschi';
const out = execFileSync('npx', ['wrangler', 'd1', 'time-travel', 'info', database, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
// Anything wrangler prints before the JSON is not part of it.
const { bookmark } = JSON.parse(out.slice(out.indexOf('{')));
if (!bookmark) throw new Error(`No bookmark in: ${out}`);
console.log(`D1 bookmark of ${database} before this deploy: ${bookmark}`);
console.log(`To restore it: npx wrangler d1 time-travel restore ${database} --bookmark=${bookmark}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `bookmark=${bookmark}\n`);
