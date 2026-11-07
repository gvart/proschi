// Local testing only (README "Testing the paid features locally"): changes the
// local D1 that `npm run dev` uses, never the remote one.
//   npm run local:pro -- <userId | github or google subject>      sets plan = 'pro'
//   npm run local:credits -- <userId | subject> <n>                adds n pack credits
// Every argument is checked, and anything starting with "-" (such as --remote)
// is refused: the only wrangler call below is hard-wired to --local.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [command, who, count] = process.argv.slice(2);
const usage = () => {
  console.error('Usage: npm run local:pro -- <userId|subject>\n       npm run local:credits -- <userId|subject> <n>');
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
if (command === 'pro' && count === undefined) {
  sql = `UPDATE users SET plan = 'pro' WHERE id IN ${user};
SELECT id, display_name, plan FROM users WHERE id IN ${user};`;
} else if (command === 'credits' && /^[1-9][0-9]{0,2}$/.test(count ?? '')) {
  // A pack grant as the webhook writes it (migration 0017), with a ref_id of its own.
  sql = `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
  SELECT id, 'grant', 'pack', '', ${Number(count)}, 'pack_5', 'local-${randomUUID()}', ${Date.now()} FROM users WHERE id IN ${user};
SELECT user_id, SUM(delta) AS pack_balance FROM credits WHERE bucket = 'pack' AND user_id IN ${user} GROUP BY user_id;`;
} else usage();

execFileSync('npx', ['wrangler', 'd1', 'execute', 'proschi', '--local', '--command', sql], { stdio: 'inherit' });
