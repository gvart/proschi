/**
 * The HTML of the VS Code preview panel, as pure functions so it can be
 * tested without VS Code. The page shows the architecture SVG and one
 * scenario's sequence SVG, picked from a list, with its use case's
 * description above it; the extension swaps the content in place (a
 * `postMessage`) as the document changes. The diagrams are drawn in a render
 * theme (theme.ts), and the page takes that theme's colours.
 */
import { randomBytes } from 'node:crypto';
import { analyze } from '../../../frontend/src/sim/analyze';
import type { ProjectResolver } from '../imports';
import { parse, type ParseOptions } from '../proschi';
import { viewOverlay } from '../terminal/systems';
import { renderSvgs, useCaseBlocksHtml } from './index';
import { esc } from './svg';
import { SKETCH, THEME_NAMES, getTheme, type RenderTheme, type ThemeName } from './theme';

export interface PreviewContent {
  /** False when the document has errors; `html` then lists them. */
  ok: boolean;
  html: string;
}

/**
 * Renders a document's preview content: the diagrams, or the list of errors
 * that stop it rendering. `options` resolves imports, as for `parse`; a
 * project resolver (`fileResolver`) also gives the reason an import failed,
 * as `proschi check` and the language server do. System boxes show the
 * simulation as `proschi render` draws them. `options.theme` (default
 * sketch-light) draws the diagrams; give the page the same one (previewHtml).
 */
export async function renderPreviewContent(
  source: string,
  options?: ParseOptions & { resolve?: ProjectResolver | ParseOptions['resolve']; theme?: RenderTheme },
): Promise<PreviewContent> {
  const result = parse(source, options);
  const resolver = options?.resolve;
  if (resolver && 'explain' in resolver) resolver.explain(result);
  const { diagram, diagnostics } = result;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    const items = errors.map((d) => `<li>${d.file ? `${esc(d.file)}: ` : ''}Line ${d.line}:${d.col}: ${esc(d.message)}</li>`).join('');
    return { ok: false, html: `<div class="errors"><strong>${errors.length} error(s)</strong>; the preview updates when they are fixed.<ul>${items}</ul></div>` };
  }

  const analysis = diagram.systems?.length && diagram.traffic?.length ? analyze(diagram) : undefined;
  const rendered = await renderSvgs(diagram, true, { systems: viewOverlay(diagram, analysis).systems, theme: options?.theme ?? SKETCH });
  const { architecture, scenarios } = rendered;
  const parts = [`<h1>${esc(diagram.title ?? 'Architecture')}</h1>`, `<section><div class="figure">${architecture}</div></section>`];
  if (scenarios.length) {
    const groups = diagram.useCases
      .map((uc) => {
        const options = scenarios
          .filter((s) => s.useCase === uc)
          .map((s) => `<option value="${esc(s.slug)}">${esc(uc.scenarios.length > 1 ? s.scenario.name : uc.name)}${s.scenario.outcome === 'error' ? ' (error)' : ''}</option>`)
          .join('');
        return `<optgroup label="${esc(uc.name)}">${options}</optgroup>`;
      })
      .join('');
    parts.push(
      `<section><label class="picker">Scenario <select id="scenario">${groups}</select></label>`,
      ...useCaseBlocksHtml(diagram, rendered, (s, hidden) => `<div class="figure scenario" data-slug="${esc(s.slug)}"${hidden ? ' hidden' : ''}>${s.svg}</div>`),
      '</section>',
    );
  } else {
    parts.push('<p class="hint">Add a <code>usecase</code> to see its sequence diagram here.</p>');
  }
  return { ok: true, html: parts.join('\n') };
}

/** A theme's page colours (its `--format html` page's): light, then dark when VS Code's colour theme is dark. */
const themeStyle = (th: RenderTheme) => {
  const on = `body[data-theme="${th.name}"]`;
  return `
${on} { ${th.page.light} }
body.vscode-dark[data-theme="${th.name}"], body.vscode-high-contrast:not(.vscode-high-contrast-light)[data-theme="${th.name}"] { ${th.page.dark} }
${on} .figure { ${th.page.figure} }`;
};

const STYLE = `
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-font-family, sans-serif); background: var(--bg); color: var(--fg); }
h1 { font-size: 16px; margin: 0 0 12px; }
section { margin-bottom: 20px; }
.figure { overflow: auto; }
.figure svg { display: block; max-width: 100%; height: auto; }
.picker { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 13px; }
select { font: inherit; color: var(--fg); background: color-mix(in srgb, var(--fg) 6%, var(--bg)); border: 1px solid color-mix(in srgb, var(--muted) 40%, transparent); border-radius: 4px; padding: 2px 4px; max-width: 100%; }
select:focus-visible, summary:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
.errors { border: 1px solid var(--error); background: color-mix(in srgb, var(--error) 10%, transparent); padding: 8px 12px; margin-bottom: 16px; border-radius: 4px; }
.errors ul { margin: 6px 0 0; padding-left: 18px; }
.hint { color: var(--muted); }
details.description { margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
details.description summary { cursor: pointer; color: var(--muted); margin-bottom: 4px; }
details.description p { margin: 0 0 8px; max-width: 900px; }
details.description table { border-collapse: collapse; margin: 0 0 12px; }
details.description th, details.description td { text-align: left; vertical-align: top; padding: 4px 12px 4px 0; border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent); }
details.description th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
details.description td:first-child { white-space: nowrap; font-weight: 600; }
details.description tr.current td { color: var(--link); }
details.description tr.current td:first-child::before { content: '▸ '; }
[hidden] { display: none !important; }
${THEME_NAMES.map((name) => themeStyle(getTheme(name))).join('\n')}
`;

// Keeps the picked scenario and whether the descriptions are open across
// updates and reloads (via the webview state), and takes the theme an update names.
const SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
const state = () => vscode.getState() || {};
const save = (patch) => vscode.setState({ ...state(), ...patch });
function show(slug) {
  root.querySelectorAll('.scenario').forEach((el) => { el.hidden = el.dataset.slug !== slug; });
  root.querySelectorAll('.usecase').forEach((el) => { el.hidden = !el.querySelector('.scenario:not([hidden])'); });
  root.querySelectorAll('.description tr[data-slug]').forEach((el) => { el.classList.toggle('current', el.dataset.slug === slug); });
}
function wire() {
  // Every description folds and unfolds together, so switching scenarios keeps it as you left it.
  const descriptions = root.querySelectorAll('details.description');
  const open = !!state().description;
  descriptions.forEach((d) => {
    d.open = open;
    d.addEventListener('toggle', () => {
      if (state().description !== d.open) save({ description: d.open });
      descriptions.forEach((other) => { if (other.open !== d.open) other.open = d.open; });
    });
  });
  const select = root.querySelector('#scenario');
  if (!select) return;
  const saved = state().scenario;
  if (saved && Array.from(select.options).some((o) => o.value === saved)) select.value = saved;
  show(select.value);
  select.addEventListener('change', () => {
    save({ scenario: select.value });
    show(select.value);
  });
}
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message && message.type === 'update' && typeof message.html === 'string') {
    if (typeof message.theme === 'string') document.body.dataset.theme = message.theme;
    root.innerHTML = message.html;
    wire();
  }
});
wire();
`;

/**
 * The whole webview page, its colours those of `theme` (default
 * sketch-light). The Content-Security-Policy allows nothing remote: only the
 * nonce'd style and script, and data: images.
 */
export function previewHtml(options: { nonce: string; cspSource: string; title: string; body: string; theme?: ThemeName }): string {
  const { nonce, cspSource, title, body, theme = SKETCH.name } = options;
  const csp = [`default-src 'none'`, `img-src ${cspSource} data:`, `style-src 'nonce-${nonce}'`, `script-src 'nonce-${nonce}'`].join('; ');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style nonce="${nonce}">${STYLE}</style>`,
    '</head>',
    `<body data-theme="${esc(theme)}">`,
    `<div id="root">${body}</div>`,
    `<script nonce="${nonce}">${SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** A random nonce for the CSP. */
export function makeNonce(): string {
  return randomBytes(16).toString('hex');
}
