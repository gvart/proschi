// The work of the Proschi GitHub Action (action.yml): checks and tests the
// matched .proschi files, writes GitHub annotations, and for the files a pull
// request changes renders the diagrams and writes the sticky comment's body.
// Plain Node (18+), no dependencies; the CLI is PROSCHI_CLI (dist/cli.cjs).
//
// Inputs come as environment variables (INPUT_*); results go to
// $GITHUB_OUTPUT, $GITHUB_STEP_SUMMARY and the files under PROSCHI_OUT.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- proschi-action -->';
/** Where the comment step puts the link to the uploaded artifact. */
export const ARTIFACT_PLACEHOLDER = '<!-- proschi-artifact -->';
/** GitHub rejects comments over 65,536 characters; leave room for the artifact link. */
const MAX_BODY = 60_000;
/** Longer links still work, but chat apps cut them and they crowd the comment. */
const MAX_LINK = 16_000;
const MAX_MERMAID = 12_000;
/** Rows in the summary of a push (no pull request to narrow the files down). */
const MAX_ROWS = 30;

const env = process.env;
const bool = (value, fallback) => (value === undefined || value === '' ? fallback : /^(true|yes|1|on)$/i.test(value.trim()));
const words = (value) => (value ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

/** A glob (`*`, `**`, `?`, `{a,b}`) as a regular expression over `/`-separated paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more directories; a trailing `**` matches anything.
      if (glob[i + 2] === '/') {
        re += '(?:[^/]*/)*';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) re += '\\{';
      else {
        re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * The files below `root` matching any of `patterns` (a leading `!` excludes),
 * as `/`-separated paths relative to it; dot directories and node_modules are skipped.
 */
export function matchFiles(patterns, root = '.') {
  const include = patterns.filter((p) => !p.startsWith('!')).map((p) => globToRegExp(p.replace(/^\.\//, '')));
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1).replace(/^\.\//, '')));
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = relative(root, full).split(sep).join('/');
        if (include.some((r) => r.test(rel)) && !exclude.some((r) => r.test(rel))) out.push(rel);
      }
    }
  };
  walk(root);
  return out;
}

/** Runs the CLI; `echo` passes its output through (annotations), otherwise it is returned. */
function cli(args, { echo = false } = {}) {
  const r = spawnSync(process.execPath, [env.PROSCHI_CLI, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (echo) {
    if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return { code: r.status ?? 2, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The .proschi files the pull request adds or changes, or undefined outside a pull request (or when the API fails). */
async function changedFiles() {
  if (!/^pull_request/.test(env.GITHUB_EVENT_NAME ?? '') || !env.GITHUB_EVENT_PATH) return undefined;
  const number = json(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.pull_request?.number;
  if (!number) return undefined;
  const api = env.GITHUB_API_URL ?? 'https://api.github.com';
  const files = [];
  try {
    for (let page = 1; page <= 30; page++) {
      const res = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}/pulls/${number}/files?per_page=100&page=${page}`, {
        headers: { accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const batch = await res.json();
      files.push(...batch.filter((f) => f.status !== 'removed').map((f) => f.filename));
      if (batch.length < 100) break;
    }
  } catch (e) {
    console.log(`::warning title=proschi::Could not list the files of pull request #${number} (${e.message}); summarising every matched file`);
    return undefined;
  }
  return files;
}

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const ms = (n) => (n >= 1000 ? `${Number((n / 1000).toFixed(2))} s` : `${Number(n.toFixed(n < 10 ? 2 : 1))} ms`);
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Everything the comment shows about one file. */
function summarise(file, report, outDir, render) {
  const row = { file, errors: 0, nodes: undefined, tests: [], requirements: [], cost: undefined, p99: undefined, link: undefined, mermaid: undefined, svgs: 0 };
  const parsed = json(cli(['parse', file]).stdout);
  row.errors = parsed ? parsed.diagnostics.filter((d) => d.severity === 'error').length : Math.max(1, report?.errors.length ?? 0);
  row.nodes = parsed?.diagram?.nodes?.length;
  for (const r of report?.results ?? []) (r.id.startsWith('req:') ? row.requirements : row.tests).push(r);

  const analysis = json(cli(['analyze', '--format', 'json', file]).stdout)?.analysis;
  const loaded = (analysis?.useCases ?? []).filter((u) => u.rps > 0);
  if (analysis && loaded.length) {
    row.cost = analysis.totalCostUsd;
    row.p99 = Math.max(...loaded.map((u) => u.percentiles.p99));
  }

  const link = cli(['share-link', file]);
  if (link.code === 0) row.link = link.stdout.trim();

  if (render && row.errors === 0) {
    const dir = join(outDir, 'diagrams', file.replace(/\.proschi$/, ''));
    mkdirSync(dir, { recursive: true });
    if (cli(['render', '--out', dir, file]).code === 0) row.svgs = readdirSync(dir).filter((f) => f.endsWith('.svg')).length;
    const md = join(outDir, 'md', file.replace(/\.proschi$/, ''));
    mkdirSync(md, { recursive: true });
    if (cli(['render', '--format', 'md', '--out', md, file]).code === 0) {
      const text = readdirSync(md).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(md, f), 'utf8'))[0] ?? '';
      const block = /```mermaid\n[\s\S]*?\n```/.exec(text)?.[0];
      if (block && block.length <= MAX_MERMAID) row.mermaid = block;
    }
  }
  return row;
}

const count = (results, word) => {
  if (results.length === 0) return '—';
  const passed = results.filter((r) => r.passed).length;
  return `${passed === results.length ? '✅' : '❌'} ${passed}/${results.length} ${word}`;
};

/** The comment (and job summary) in Markdown. */
export function renderBody({ rows, totals, checkFailed, testFailed, testsRun, more, sha }) {
  const ok = !checkFailed && !testFailed;
  const lines = [
    MARKER,
    `### ${ok ? '✅' : '❌'} Proschi`,
    '',
    `${totals.files} file${totals.files === 1 ? '' : 's'} checked${testsRun ? `, ${totals.passed} of ${totals.passed + totals.failed} requirements and tests passed` : ''}${checkFailed ? ', **with errors**' : ''}.${sha ? ` Commit ${sha.slice(0, 7)}.` : ''}`,
    '',
  ];
  if (rows.length === 0) {
    lines.push('No changed `.proschi` files in this pull request.');
  } else {
    lines.push('| File | Nodes | Tests | Requirements | Cost/month | Worst p99 | |', '|---|--:|---|---|--:|--:|---|');
    for (const r of rows) {
      const name = `\`${cell(r.file)}\``;
      if (r.errors) {
        lines.push(`| ${name} | ${r.nodes ?? '—'} | ❌ ${r.errors} error${r.errors === 1 ? '' : 's'} | | | | ${r.link ? `[Open in Proschi](${r.link})` : ''} |`);
        continue;
      }
      lines.push(
        `| ${name} | ${r.nodes ?? '—'} | ${count(r.tests, 'passed')} | ${count(r.requirements, 'met')} | ${r.cost === undefined ? '—' : usd(r.cost)} | ${r.p99 === undefined ? '—' : ms(r.p99)} | ${r.link ? `[Open in Proschi](${r.link})` : r.linkDropped ? 'diagram too large for a link' : ''} |`,
      );
    }
    if (more) lines.push('', `…and ${more} more file${more === 1 ? '' : 's'}.`);

    const failures = rows.flatMap((r) => [...r.requirements, ...r.tests].filter((t) => !t.passed).map((t) => ({ file: r.file, ...t })));
    if (failures.length) {
      lines.push('', '<details><summary>Failing requirements and tests</summary>', '');
      for (const f of failures) {
        const at = f.loc ? `${f.loc.file ?? f.file}:${f.loc.line}` : f.file;
        lines.push(`- \`${cell(at)}\` **${cell(f.name)}**: ${cell(f.message)}${f.hint ? ` _${cell(f.hint)}_` : ''}`);
      }
      lines.push('', '</details>');
    }
    for (const r of rows.filter((r) => r.mermaid)) {
      lines.push('', `<details><summary>Architecture of <code>${r.file.replace(/[<>&]/g, '')}</code></summary>`, '', r.mermaid, '', '</details>');
    }
  }
  lines.push('', ARTIFACT_PLACEHOLDER, '', '<sub>Posted by the <a href="https://github.com/gvart/proschi/tree/main/action">Proschi action</a>; updated on every push.</sub>');
  return lines.join('\n');
}

/** Drops diagrams, then links, from the end until the body fits in a comment. */
export function fit(state) {
  let body = renderBody(state);
  for (const key of ['mermaid', 'link']) {
    for (let i = state.rows.length - 1; i >= 0 && body.length > MAX_BODY; i--) {
      if (!state.rows[i][key]) continue;
      state.rows[i][key] = undefined;
      if (key === 'link') state.rows[i].linkDropped = true;
      body = renderBody(state);
    }
  }
  if (body.length > MAX_BODY) {
    state.more = (state.more ?? 0) + state.rows.length - 20;
    state.rows = state.rows.slice(0, 20);
    body = renderBody(state);
  }
  return body;
}

function output(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  if (!env.PROSCHI_CLI || !existsSync(env.PROSCHI_CLI)) {
    console.log(`::error title=proschi::The proschi CLI was not found at '${env.PROSCHI_CLI ?? ''}'`);
    return 1;
  }
  const outDir = env.PROSCHI_OUT ?? join(env.RUNNER_TEMP ?? '.', 'proschi');
  mkdirSync(outDir, { recursive: true });
  const runTests = bool(env.INPUT_TEST, true);
  const render = bool(env.INPUT_RENDER, true);

  const files = matchFiles(words(env.INPUT_FILES).length ? words(env.INPUT_FILES) : ['**/*.proschi']);
  output('files', files.length);
  if (files.length === 0) {
    console.log(`::warning title=proschi::No files match '${words(env.INPUT_FILES).join(', ') || '**/*.proschi'}'`);
    writeFileSync(join(outDir, 'comment.md'), '');
    output('check-failed', 'false');
    output('test-failed', 'false');
    return 0;
  }
  console.log(`Checking ${files.length} file${files.length === 1 ? '' : 's'} with proschi ${cli(['--version']).stdout.trim()}`);

  const openapi = words(env.INPUT_OPENAPI).flatMap((m) => ['--openapi', m]);
  const check = cli(['check', '--format', 'github', ...openapi, ...files], { echo: true });
  if (check.code === 2) return 2;

  let reports = [];
  let test = { code: 0 };
  if (runTests) {
    test = cli(['test', '--format', 'github', ...files], { echo: true });
    reports = json(cli(['test', '--format', 'json', ...files]).stdout) ?? [];
  }
  const byFile = new Map(reports.map((r) => [r.file.split(sep).join('/'), r]));
  const results = reports.flatMap((r) => r.results);

  const changed = await changedFiles();
  let selected = changed ? files.filter((f) => changed.includes(f)) : files;
  const more = Math.max(0, selected.length - MAX_ROWS);
  selected = selected.slice(0, MAX_ROWS);
  const rows = selected.map((f) => summarise(f, byFile.get(f), outDir, render));

  const state = {
    rows,
    totals: { files: files.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length },
    checkFailed: check.code !== 0,
    testFailed: test.code !== 0,
    testsRun: runTests,
    more,
    sha: json(env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? readFileSync(env.GITHUB_EVENT_PATH, 'utf8') : '')?.pull_request?.head?.sha ?? env.GITHUB_SHA,
  };
  const body = fit(state);
  writeFileSync(join(outDir, 'comment.md'), body);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${body.replace(MARKER, '').replace(ARTIFACT_PLACEHOLDER, '')}\n`);

  output('check-failed', String(state.checkFailed));
  output('test-failed', String(state.testFailed));
  output('rendered', String(rows.some((r) => r.svgs > 0)));
  output('noteworthy', String(rows.length > 0 || state.checkFailed || state.testFailed));
  return 0;
}

// Only run when executed, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => (process.exitCode = code),
    (e) => {
      console.log(`::error title=proschi::${String(e?.stack ?? e).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
      process.exitCode = 1;
    },
  );
}
