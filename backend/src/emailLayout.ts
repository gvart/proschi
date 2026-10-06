/**
 * The look of Proschi's emails and of the small pages behind their links:
 * the site's neo-brutalist style (frontend/src/design/tokens.css) in a form
 * mail clients keep. Thick ink borders, hard offset shadows, pop colours and
 * the wordmark in chunky type, with Kernel the cat SRE chiming in.
 *
 * Emails are tables with every style inline (Gmail, Outlook and Apple Mail
 * drop or ignore most of a <style>; the one here only tightens the layout on
 * small screens). The shadows are extra table cells, the buttons padded cells
 * (bulletproof in Outlook), and the fonts fall back to the system's: web
 * fonts rarely load in mail, and nothing here loads from anywhere.
 *
 * This module has no imports, so scripts/email-preview.mjs can render it
 * outside the Worker.
 */

/** The site's palette (tokens.css, light theme). */
export const COLORS = {
  paper: '#fff8e7',
  surface: '#ffffff',
  ink: '#111111',
  muted: '#5b5b5b',
  yellow: '#ffd23f',
  pink: '#ff5da2',
  blue: '#3d5afe',
  green: '#00b894',
  red: '#ff3b30',
  lilac: '#b69cff',
  /** Kernel's sticker disc (Mascot.tsx). */
  disc: '#fdf0cf',
} as const;

export type Accent = 'yellow' | 'pink' | 'blue' | 'green' | 'red' | 'lilac';

/** Text on each accent: ink, except on blue, where white reads better. */
const ON: Record<Accent, string> = { yellow: COLORS.ink, pink: COLORS.ink, blue: '#ffffff', green: COLORS.ink, red: COLORS.ink, lilac: COLORS.ink };

const DISPLAY = "'Bricolage Grotesque Variable','Bricolage Grotesque','Archivo',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SANS = "'Archivo',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Link {
  label: string;
  url: string;
}

/** One email, as data: renderEmail turns it into HTML and plain text with the same content. */
export interface EmailSpec {
  /** The subject, also the HTML's <title>. */
  subject: string;
  accent: Accent;
  /** The preview text inboxes show after the subject. */
  preheader: string;
  /** A short tag in the header, e.g. "🔥 Streak alert". */
  badge: string;
  headline: string;
  /** The big number (or emoji) of the email, with its label. */
  hero?: { value: string; label: string; note?: string };
  paragraphs: string[];
  /** Small tags under the text, e.g. the topics of the cards due. */
  chips?: { title: string; items: string[] };
  /** A grid of numbers, three a row. */
  stats?: { value: string; label: string; accent: Accent }[];
  cta: Link;
  /** A plain link under the button. */
  secondary?: Link;
  /** Text under the button, e.g. how long a link works. */
  after?: string[];
  /** Kernel's one-liner. */
  kernel: string;
  /** Why the reader got this, and the links to change or stop it. */
  footer: { why: string; links: Link[] };
}

const px = (n: number) => `${n}px`;
const spacer = (h: number) => `<tr><td height="${h}" style="height:${px(h)};font-size:0;line-height:0;">&nbsp;</td></tr>`;
const table = (attrs: string, rows: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs ? ` ${attrs}` : ''}>${rows}</table>`;

/**
 * A bordered cell with a hard offset shadow (CSS box-shadow does not survive
 * mail clients): the cell spans two rows, and a column and a row of ink cells,
 * each starting `offset` in, draw the shadow to its right and below.
 */
export function shadowBox(cellStyle: string, inner: string, opts: { bg: string; offset?: number; width?: string; bgcolor?: string }): string {
  const o = opts.offset ?? 6;
  const blank = `font-size:0;line-height:0;`;
  return table(
    opts.width ? `width="${opts.width}"` : '',
    `<tr><td rowspan="2" valign="top"${opts.bgcolor ? ` bgcolor="${opts.bgcolor}"` : ''} style="${cellStyle}">${inner}</td>` +
      `<td width="${o}" height="${o}" bgcolor="${opts.bg}" style="width:${px(o)};height:${px(o)};background:${opts.bg};min-width:${px(o)};${blank}"><div style="width:${px(o)};min-width:${px(o)};${blank}">&nbsp;</div></td></tr>` +
      `<tr><td width="${o}" bgcolor="${COLORS.ink}" style="width:${px(o)};background:${COLORS.ink};min-width:${px(o)};${blank}"><div style="width:${px(o)};min-width:${px(o)};${blank}">&nbsp;</div></td></tr>` +
      `<tr><td colspan="2" style="${blank}">${table(
        'width="100%"',
        `<tr><td width="${o}" height="${o}" bgcolor="${opts.bg}" style="width:${px(o)};height:${px(o)};background:${opts.bg};${blank}">&nbsp;</td>` +
          `<td height="${o}" bgcolor="${COLORS.ink}" style="height:${px(o)};background:${COLORS.ink};${blank}">&nbsp;</td></tr>`,
      )}</td></tr>`,
  );
}

/** The logo: two wired boxes on a yellow tile (Wordmark.tsx), drawn with cells, then the name. */
function wordmark(): string {
  const box = (fill: string) =>
    `<td width="8" height="8" bgcolor="${fill}" style="width:8px;height:8px;background:${fill};border:2px solid ${COLORS.ink};font-size:0;line-height:0;">&nbsp;</td>`;
  const gap = (w: number) => `<td width="${w}" style="width:${px(w)};font-size:0;line-height:0;">&nbsp;</td>`;
  const glyph = table(
    'align="center"',
    `<tr>${box(COLORS.surface)}${gap(4)}${gap(12)}</tr><tr><td colspan="3" height="2" style="height:2px;font-size:0;line-height:0;">&nbsp;</td></tr><tr>${gap(12)}${gap(4)}${box(COLORS.pink)}</tr>`,
  );
  const tile = shadowBox(`width:34px;height:34px;padding:0;border:3px solid ${COLORS.ink};background:${COLORS.yellow};vertical-align:middle;`, glyph, {
    bg: COLORS.paper,
    offset: 3,
    bgcolor: COLORS.yellow,
  });
  return table(
    '',
    `<tr><td valign="middle" style="padding:0 10px 0 0;">${tile}</td>` +
      `<td valign="middle" style="font-family:${DISPLAY};font-size:32px;line-height:1;font-weight:800;letter-spacing:-1.5px;color:${COLORS.ink};padding-bottom:4px;">` +
      `<a href="https://proschi.app/" style="color:${COLORS.ink};text-decoration:none;">proschi</a></td></tr>`,
  );
}

function badge(text: string, accent: Accent): string {
  return table(
    'align="right"',
    `<tr><td bgcolor="${COLORS[accent]}" style="background:${COLORS[accent]};border:3px solid ${COLORS.ink};border-radius:999px;padding:5px 12px;font-family:${MONO};font-size:12px;line-height:1.2;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${ON[accent]};white-space:nowrap;">${escapeHtml(text)}</td></tr>`,
  );
}

function button(link: Link, accent: Accent): string {
  // The link fills the padded cell; Outlook ignores the link's padding, and the cell's keeps the button chunky there.
  const a = `<a href="${escapeHtml(link.url)}" target="_blank" style="display:inline-block;padding:16px 26px;font-family:${DISPLAY};font-size:19px;line-height:1.1;font-weight:800;color:${ON[accent]};text-decoration:none;letter-spacing:-0.2px;">${escapeHtml(link.label)}&nbsp;&rarr;</a>`;
  return shadowBox(`border:3px solid ${COLORS.ink};border-radius:4px;background:${COLORS[accent]};text-align:center;mso-padding-alt:16px 26px;`, a, {
    bg: COLORS.surface,
    offset: 5,
    bgcolor: COLORS[accent],
  });
}

function hero(h: NonNullable<EmailSpec['hero']>, accent: Accent): string {
  const number = shadowBox(
    `border:3px solid ${COLORS.ink};background:${COLORS[accent]};padding:10px 18px;text-align:center;font-family:${DISPLAY};font-size:64px;line-height:1;font-weight:800;letter-spacing:-2px;color:${ON[accent]};white-space:nowrap;`,
    `<span class="hero-num">${escapeHtml(h.value)}</span>`,
    { bg: COLORS.surface, offset: 5, bgcolor: COLORS[accent] },
  );
  return table(
    'width="100%"',
    `<tr><td valign="middle" width="1" style="padding:0 16px 0 0;">${number}</td>` +
      `<td valign="middle" style="font-family:${MONO};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${COLORS.ink};">${escapeHtml(h.label)}` +
      (h.note ? `<div style="margin-top:6px;font-family:${SANS};font-size:15px;line-height:1.4;font-weight:400;letter-spacing:0;text-transform:none;color:${COLORS.muted};">${escapeHtml(h.note)}</div>` : '') +
      `</td></tr>`,
  );
}

function stats(items: NonNullable<EmailSpec['stats']>): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 3) {
    const cells = items.slice(i, i + 3).map(
      (s) =>
        `<td width="33%" valign="top" style="width:33%;padding:0 4px 8px;">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td bgcolor="${COLORS[s.accent]}" style="background:${COLORS[s.accent]};border:3px solid ${COLORS.ink};padding:10px 8px;text-align:center;">` +
        `<div class="stat-num" style="font-family:${DISPLAY};font-size:30px;line-height:1;font-weight:800;letter-spacing:-1px;color:${ON[s.accent]};">${escapeHtml(s.value)}</div>` +
        `<div style="margin-top:4px;font-family:${MONO};font-size:10px;line-height:1.3;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:${ON[s.accent]};">${escapeHtml(s.label)}</div>` +
        `</td></tr></table></td>`,
    );
    while (cells.length < 3) cells.push('<td width="33%" style="width:33%;">&nbsp;</td>');
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return table('width="100%"', rows.join(''));
}

function chips(c: NonNullable<EmailSpec['chips']>): string {
  const items = c.items
    .map(
      (t) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:2px solid ${COLORS.ink};border-radius:999px;background:${COLORS.paper};font-family:${MONO};font-size:12px;line-height:1.3;font-weight:700;color:${COLORS.ink};white-space:nowrap;">${escapeHtml(t)}</span>`,
    )
    .join('');
  return `<div style="font-family:${MONO};font-size:11px;line-height:1.3;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${COLORS.muted};margin:0 0 8px;">${escapeHtml(c.title)}</div><div>${items}</div>`;
}

function kernel(line: string): string {
  const face = `<td width="52" valign="top" style="width:52px;padding:0 12px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="46" height="46" align="center" valign="middle" bgcolor="${COLORS.disc}" style="width:46px;height:46px;background:${COLORS.disc};border:3px solid ${COLORS.ink};border-radius:999px;font-size:26px;line-height:46px;text-align:center;">&#128049;</td></tr></table></td>`;
  const bubble = `<td valign="top" bgcolor="${COLORS.paper}" style="background:${COLORS.paper};border:3px solid ${COLORS.ink};border-radius:4px;padding:10px 14px;">` +
    `<div style="font-family:${MONO};font-size:11px;line-height:1.3;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${COLORS.muted};margin:0 0 4px;">Kernel &middot; cat SRE</div>` +
    `<div style="font-family:${SANS};font-size:15px;line-height:1.45;color:${COLORS.ink};">${escapeHtml(line)}</div></td>`;
  return table('width="100%"', `<tr>${face}${bubble}</tr>`);
}

const para = (text: string, last = false) =>
  `<p style="margin:0 0 ${last ? 0 : 14}px;font-family:${SANS};font-size:16px;line-height:1.55;color:${COLORS.ink};">${escapeHtml(text)}</p>`;

/** The preview text: hidden, padded so the inbox shows no body text after it. */
const preheader = (text: string) =>
  `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLORS.paper};">${escapeHtml(text)}${'&#8199;&#847;'.repeat(60)}</div>`;

/** A spec's HTML (a table layout, every style inline) and its plain-text alternative. */
export function renderEmail(spec: EmailSpec): { html: string; text: string } {
  return { html: emailHtml(spec), text: emailText(spec) };
}

function emailHtml(spec: EmailSpec): string {
  const accent = COLORS[spec.accent];
  const band =
    `<tr><td bgcolor="${accent}" class="px" style="background:${accent};border-bottom:3px solid ${COLORS.ink};padding:22px 28px;">` +
    `<h1 class="h1" style="margin:0;font-family:${DISPLAY};font-size:32px;line-height:1.08;font-weight:800;letter-spacing:-1px;color:${ON[spec.accent]};">${escapeHtml(spec.headline)}</h1></td></tr>`;
  const body: string[] = [];
  if (spec.hero) body.push(hero(spec.hero, spec.accent), '<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>');
  spec.paragraphs.forEach((p, i) => body.push(para(p, i === spec.paragraphs.length - 1)));
  if (spec.stats?.length) body.push('<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>', stats(spec.stats));
  if (spec.chips?.items.length) body.push('<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>', chips(spec.chips));
  body.push('<div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>', button(spec.cta, spec.accent));
  if (spec.secondary)
    body.push(
      `<p style="margin:16px 0 0;font-family:${SANS};font-size:14px;line-height:1.5;"><a href="${escapeHtml(spec.secondary.url)}" target="_blank" style="color:${COLORS.ink};font-weight:700;text-decoration:underline;">${escapeHtml(spec.secondary.label)}</a></p>`,
    );
  for (const a of spec.after ?? []) body.push(`<p style="margin:14px 0 0;font-family:${SANS};font-size:14px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(a)}</p>`);
  body.push('<div style="height:26px;line-height:26px;font-size:0;">&nbsp;</div>', kernel(spec.kernel));

  const card = shadowBox(
    `border:3px solid ${COLORS.ink};background:${COLORS.surface};padding:0;`,
    table('width="100%"', `${band}<tr><td class="px" style="padding:26px 28px 28px;">${body.join('')}</td></tr>`),
    { bg: COLORS.paper, offset: 8, width: '100%', bgcolor: COLORS.surface },
  );

  const links = spec.footer.links
    .map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" style="color:${COLORS.ink};font-weight:700;text-decoration:underline;">${escapeHtml(l.label)}</a>`)
    .join(' &nbsp;&middot;&nbsp; ');
  const footer =
    `<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(spec.footer.why)}</p>` +
    (links ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:1.6;color:${COLORS.muted};">${links}</p>` : '') +
    `<p style="margin:0;font-family:${MONO};font-size:11px;line-height:1.5;letter-spacing:0.3px;color:${COLORS.muted};">PROSCHI &middot; system design practice &middot; <a href="https://proschi.app/" target="_blank" style="color:${COLORS.muted};">proschi.app</a></p>`;

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(spec.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light;supported-color-schemes:light}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media (max-width:480px){
.px{padding-left:18px!important;padding-right:18px!important}
.h1{font-size:27px!important}
.hero-num{font-size:52px!important}
.stat-num{font-size:24px!important}
.outer{padding:16px 10px 28px!important}
}
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${COLORS.paper};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;" bgcolor="${COLORS.paper}">
${preheader(spec.preheader)}
${table(
  `width="100%" bgcolor="${COLORS.paper}" style="background:${COLORS.paper};"`,
  `<tr><td align="center" class="outer" style="padding:28px 16px 36px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
${table(
  'width="100%" style="max-width:560px;margin:0 auto;"',
  `<tr><td style="padding:0 0 18px;">${table('width="100%"', `<tr><td valign="middle">${wordmark()}</td><td valign="middle" align="right">${badge(spec.badge, spec.accent)}</td></tr>`)}</td></tr>` +
    `<tr><td>${card}</td></tr>` +
    spacer(22) +
    `<tr><td style="padding:0 4px;">${footer}</td></tr>`,
)}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`,
)}
</body>
</html>
`;
}

function emailText(spec: EmailSpec): string {
  const out: string[] = [`PROSCHI  [${spec.badge}]`, `${spec.headline}\n${'='.repeat(Math.min(60, [...spec.headline].length))}`];
  if (spec.hero) out.push(`${spec.hero.value} ${spec.hero.label}${spec.hero.note ? `\n${spec.hero.note}` : ''}`);
  out.push(...spec.paragraphs);
  if (spec.stats?.length) out.push(spec.stats.map((s) => `- ${s.label}: ${s.value}`).join('\n'));
  if (spec.chips?.items.length) out.push(`${spec.chips.title}: ${spec.chips.items.join(', ')}`);
  out.push(`>> ${spec.cta.label}: ${spec.cta.url}`);
  if (spec.secondary) out.push(`${spec.secondary.label}: ${spec.secondary.url}`);
  out.push(...(spec.after ?? []));
  out.push(`Kernel, the cat SRE: "${spec.kernel}"`);
  out.push('--', spec.footer.why, ...spec.footer.links.map((l) => `${l.label}: ${l.url}`), 'Proschi, system design practice: https://proschi.app/');
  return out.join('\n\n') + '\n';
}

// ---- The pages behind the links ----

export interface PageSpec {
  title: string;
  message: string;
  accent: Accent;
  /** An emoji for the badge. */
  emoji: string;
  kernel: string;
  /** A form button (POST to the url); without one, a link to the account page. */
  action?: Link;
}

/**
 * A small standalone page (no scripts, no external anything: the CSP is
 * default-src 'none' with inline styles allowed): the same card as the emails,
 * with a real box-shadow, and a dark theme like the site's.
 */
export function pageHtml(spec: PageSpec): string {
  const a = COLORS[spec.accent];
  const control = spec.action
    ? `<form method="post" action="${escapeHtml(spec.action.url)}"><button class="btn" type="submit">${escapeHtml(spec.action.label)} &rarr;</button></form>`
    : '<a class="btn" href="/practice/#/me">Go to your account &rarr;</a>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${escapeHtml(spec.title)} · Proschi</title>
<style>
:root{--paper:${COLORS.paper};--surface:#fff;--ink:#111;--muted:#5b5b5b;--shadow:#111;--accent:${a};--on:${ON[spec.accent]};--yellow:${COLORS.yellow};--pink:${COLORS.pink};--disc:${COLORS.disc}}
@media (prefers-color-scheme:dark){:root{--paper:#141318;--surface:#1e1d24;--ink:#f4efe3;--muted:#a9a5b4;--shadow:#605496}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:40px 16px 56px;background:var(--paper);color:var(--ink);font:16px/1.55 'Archivo',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
main{max-width:540px;margin:0 auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 22px}
.mark{display:inline-flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font:800 32px/1 ${DISPLAY};letter-spacing:-.045em}
.tile{position:relative;width:40px;height:40px;flex:none;background:var(--yellow);border:3px solid var(--ink);border-radius:4px;box-shadow:3px 3px 0 var(--shadow)}
.tile i{position:absolute;width:12px;height:12px;border:2px solid #111;background:#fff}
.tile i:first-child{left:4px;top:4px}.tile i:last-child{right:4px;bottom:4px;background:var(--pink)}
.badge{padding:5px 12px;border:3px solid var(--ink);border-radius:999px;background:var(--accent);color:var(--on);font:700 12px/1.2 ${MONO};letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.card{background:var(--surface);border:3px solid var(--ink);box-shadow:8px 8px 0 var(--shadow)}
.band{background:var(--accent);color:var(--on);border-bottom:3px solid var(--ink);padding:22px 26px}
h1{margin:0;font:800 34px/1.08 ${DISPLAY};letter-spacing:-.03em}
.body{padding:24px 26px 26px}
p{margin:0 0 4px;word-wrap:break-word;overflow-wrap:anywhere}
.btn{display:inline-block;margin-top:20px;padding:15px 24px;border:3px solid var(--ink);border-radius:4px;background:var(--accent);color:var(--on);box-shadow:5px 5px 0 var(--shadow);font:800 18px/1.1 ${DISPLAY};text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--shadow)}
.btn:active{transform:translate(5px,5px);box-shadow:0 0 0 var(--shadow)}
.btn:focus-visible{outline:3px solid ${COLORS.blue};outline-offset:3px}
.kernel{display:flex;gap:12px;align-items:flex-start;margin-top:26px}
.face{flex:none;width:46px;height:46px;border:3px solid var(--ink);border-radius:50%;background:var(--disc);display:grid;place-items:center;font-size:24px}
.bubble{flex:1;border:3px solid var(--ink);border-radius:4px;background:var(--paper);padding:9px 13px;font-size:15px}
.bubble b{display:block;font:700 11px/1.3 ${MONO};letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
footer{margin-top:24px;font:11px/1.5 ${MONO};color:var(--muted);letter-spacing:.03em}
@media (max-width:420px){h1{font-size:28px}.band,.body{padding-left:18px;padding-right:18px}.mark{font-size:28px}}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
</style></head>
<body><main>
<div class="top"><a class="mark" href="/" aria-label="Proschi home"><span class="tile" aria-hidden="true"><i></i><i></i></span>proschi</a><span class="badge">${spec.emoji} Reminders</span></div>
<div class="card"><div class="band"><h1>${escapeHtml(spec.title)}</h1></div>
<div class="body"><p>${escapeHtml(spec.message)}</p>
${control}
<div class="kernel"><div class="face" aria-hidden="true">&#128049;</div><div class="bubble"><b>Kernel &middot; cat SRE</b>${escapeHtml(spec.kernel)}</div></div>
</div></div>
<footer>PROSCHI &middot; system design practice</footer>
</main></body></html>`;
}
