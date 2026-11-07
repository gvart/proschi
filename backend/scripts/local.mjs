// Local testing only (README "Testing the paid features locally"): changes the
// local D1 that `npm run dev` uses, never the remote one.
//   npm run local:pro -- <userId | github or google subject>      sets plan = 'pro'
//   npm run local:max -- <userId | github or google subject>      sets plan = 'max'
//   npm run local:credits -- <userId | subject> <n>                adds n top-up credits (up to 3 decimals)
// Every argument is checked, and anything starting with "-" (such as --remote)
// is refused: the only wrangler call below is hard-wired to --local.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [command, who, count] = process.argv.slice(2);
const usage = () => {
  console.error('Usage: npm run local:pro -- <userId|subject>\n       npm run local:max -- <userId|subject>\n       npm run local:credits -- <userId|subject> <n>');
  process.exit(2);
};
if (process.argv.slice(2).some((a) => a.startsWith('-'))) {
  console.error('Refused: this helper only ever changes the local D1 (--local); it takes no flags.');
  process.exit(2);
}
// Ids are UUIDs and provider subjects are digits or similar: nothing that needs quoting.
if (!who || !/^[A-Za-z0-9_.:@-]+$/.test(who)) usage();

// The account: by its id, or by a GitHub or Google subject (identities.subject).
const user = `(SELECT id FROM users WHERE id = '${who}' UNION SELECT user_id FROM identities WHERE subject = '${who}')`;
let sql;
if ((command === 'pro' || command === 'max') && count === undefined) {
  sql = `UPDATE users SET plan = '${command}' WHERE id IN ${user};
SELECT id, display_name, plan FROM users WHERE id IN ${user};`;
} else if (command === 'credits' && /^[0-9]{1,5}(\.[0-9]{1,3})?$/.test(count ?? '') && Number(count) > 0 && Number(count) <= 10_000) {
  // A top-up as the webhook writes it (migration 0024), in millicredits, with a ref_id of its own.
  const mc = Math.round(Number(count) * 1000);
  sql = `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
  SELECT id, 'topup', 'topup', '', ${mc}, 'credits_1000', 'local-${randomUUID()}', ${Date.now()} FROM users WHERE id IN ${user};
SELECT user_id, SUM(delta_mc) / 1000.0 AS topup_credits FROM credits WHERE bucket = 'topup' AND user_id IN ${user} GROUP BY user_id;`;
} else usage();

execFileSync('npx', ['wrangler', 'd1', 'execute', 'proschi', '--local', '--command', sql], { stdio: 'inherit' });
