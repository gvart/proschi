// Renders every email (and the pages behind their links) with sample data
// to backend/email-previews/*.html (gitignored), to open in a browser:
//
//   node scripts/email-preview.mjs
//
// The emails come from src/emails.ts and src/emailLayout.ts, bundled with
// esbuild (which wrangler brings along) since they are TypeScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const here = new URL('..', import.meta.url).pathname;
const out = new URL('../email-previews/', import.meta.url).pathname;

const bundle = await build({
  stdin: {
    contents: "export * from './src/emails.ts'; export { pageHtml } from './src/emailLayout.ts';",
    resolveDir: here,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const { confirmationEmail, reminderEmail, pageHtml } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const origin = 'https://proschi.app';
const opts = { origin, unsubscribeUrl: `${origin}/api/email/unsubscribe?token=sample-token` };
const streak = { current: 6, today: { day: '2026-10-06', reviews: 3, solves: 0 } };
const goal = { reviews: 10, solves: 1 };
const recap = { start: '2026-09-28', end: '2026-10-04', reviews: 142, newCards: 23, solves: 3, challenges: 5, runs: 2, goalDays: 6, streak: 12 };

const emails = {
  confirmation: confirmationEmail(`${origin}/api/email/confirm?token=sample-token`),
  streak: reminderEmail('streak', { streak, goal }, opts),
  cards: reminderEmail('cards', { due: 17, topics: ['Caching', 'Databases', 'Queues'] }, opts),
  recap: reminderEmail('recap', { recap }, opts),
  'recap-quiet': reminderEmail('recap', { recap: { ...recap, reviews: 12, newCards: 0, solves: 1, challenges: 0, runs: 0, goalDays: 2, streak: 0 } }, opts),
  paused: reminderEmail('cards', { due: 9 }, { ...opts, paused: true }),
};

const pages = {
  'page-confirm': { title: 'Confirm your address', message: 'Get Proschi reminders at ada@example.com?', accent: 'blue', emoji: '✉', kernel: 'One click, and Kernel starts guarding your streak.', action: { label: 'Confirm my address', url: '#' } },
  'page-confirmed': { title: 'Address confirmed', message: 'Reminders will go to ada@example.com. Change which ones, or turn them off, on your account page.', accent: 'green', emoji: '✅', kernel: 'Deployed to production. Kernel is now on call for your streak. 🐾' },
  'page-unsubscribe': { title: 'Unsubscribe', message: 'Stop all Proschi reminders to ada@example.com and delete the address?', accent: 'pink', emoji: '👋', kernel: 'Kernel will miss paging you, but respects a clean rollback.', action: { label: 'Unsubscribe', url: '#' } },
  'page-expired': { title: 'This link has expired', message: 'Confirmation links work for two days. Enter your address again on your account page for a new one.', accent: 'red', emoji: '⌛', kernel: 'Kernel checked the logs: this token timed out.' },
};

mkdirSync(out, { recursive: true });
const index = [];
for (const [name, email] of Object.entries(emails)) {
  writeFileSync(`${out}${name}.html`, email.html);
  writeFileSync(`${out}${name}.txt`, `Subject: ${email.subject}\n\n${email.text}`);
  index.push(`<li><a href="${name}.html">${name}</a> (<a href="${name}.txt">text</a>): ${email.subject.replace(/</g, '&lt;')}</li>`);
}
for (const [name, spec] of Object.entries(pages)) {
  writeFileSync(`${out}${name}.html`, pageHtml(spec));
  index.push(`<li><a href="${name}.html">${name}</a></li>`);
}
writeFileSync(`${out}index.html`, `<!doctype html><meta charset="utf-8"><title>Email previews</title><h1>Proschi email previews</h1><ul>${index.join('')}</ul>`);
console.log(`Wrote ${Object.keys(emails).length} emails and ${Object.keys(pages).length} pages to ${out}`);
