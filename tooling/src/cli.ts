/**
 * `proschi check` validates .proschi files (for CI and pre-commit hooks);
 * `proschi parse` prints the parsed diagram as JSON (see schema/).
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './proschi';
import { checkFiles, parseFile } from './imports';

declare const PROSCHI_VERSION: string;
const VERSION = typeof PROSCHI_VERSION === 'string' ? PROSCHI_VERSION : 'dev';

const USAGE = `Usage:
  proschi check [--strict] [--format text|github|json] <file|dir>...
  proschi parse <file>
  proschi --version

check   Reports errors and warnings. Directories are searched for *.proschi files.
        Imports are followed; problems are reported under the file they occur in.
        Exits with 1 if any file has an error (or a warning, with --strict).
parse   Prints {"diagram", "diagnostics"} as JSON; the shape is described by
        schema/proschi-diagram.schema.json.`;

export interface CheckResult {
  file: string;
  diagnostics: Diagnostic[];
}

/** Expands directories into the .proschi files below them, skipping node_modules and dot dirs. */
export function collectFiles(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.proschi')) out.push(full);
    }
  };
  for (const p of paths) {
    if (statSync(p).isDirectory()) walk(p);
    else out.push(p);
  }
  return out;
}

export function format(results: CheckResult[], style: 'text' | 'github' | 'json'): string {
  if (style === 'json') return JSON.stringify(results, null, 2);
  const lines: string[] = [];
  for (const { file, diagnostics } of results) {
    for (const d of diagnostics) {
      if (style === 'github') {
        const level = d.severity === 'error' ? 'error' : 'warning';
        lines.push(`::${level} file=${file},line=${d.line},col=${d.col},title=proschi::${d.message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
      } else {
        lines.push(`${file}:${d.line}:${d.col}: ${d.severity}: ${d.message}`);
      }
    }
  }
  if (style === 'text') {
    const errors = results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 'error').length, 0);
    const warnings = results.reduce((n, r) => n + r.diagnostics.filter((d) => d.severity === 'warning').length, 0);
    const files = results.length === 1 ? '1 file' : `${results.length} files`;
    lines.push(errors || warnings ? `${files}: ${errors} error(s), ${warnings} warning(s)` : `${files}: no problems`);
  }
  return lines.join('\n');
}

export function run(argv: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): number {
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-v') {
    out(VERSION);
    return 0;
  }
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    out(USAGE);
    return command ? 0 : 2;
  }

  if (command === 'parse') {
    if (rest.length !== 1) {
      err(USAGE);
      return 2;
    }
    out(JSON.stringify(parseFile(rest[0]), null, 2));
    return 0;
  }

  if (command === 'check') {
    let strict = false;
    let style: 'text' | 'github' | 'json' = 'text';
    const paths: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--strict') strict = true;
      else if (arg === '--format') {
        const value = rest[++i];
        if (value !== 'text' && value !== 'github' && value !== 'json') {
          err(`Unknown format '${value ?? ''}'; use text, github or json`);
          return 2;
        }
        style = value;
      } else if (arg.startsWith('-')) {
        err(`Unknown option ${arg}\n\n${USAGE}`);
        return 2;
      } else paths.push(arg);
    }
    if (paths.length === 0) {
      err(USAGE);
      return 2;
    }

    let files: string[];
    try {
      files = collectFiles(paths);
    } catch (e) {
      err(String((e as Error).message));
      return 2;
    }
    const results = checkFiles(files);
    const text = format(results, style);
    if (text) out(text);
    const failed = results.some((r) => r.diagnostics.some((d) => d.severity === 'error' || strict));
    return failed ? 1 : 0;
  }

  err(`Unknown command '${command}'\n\n${USAGE}`);
  return 2;
}

// Only run when executed, not when imported by the tests.
if (typeof PROSCHI_VERSION === 'string') process.exitCode = run(process.argv.slice(2));
