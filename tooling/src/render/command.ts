import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse } from '../proschi';
import { FORMATS, renderFiles, type RenderFormat } from './index';

export const RENDER_USAGE = `  proschi render [--out <dir>] [--format svg|md|html] <file>`;

export const RENDER_HELP = `render  Writes the diagram as static files into --out (default: the current
        directory). svg (default): architecture.svg and <usecase>--<scenario>.svg
        per scenario; md: <file>.md with Mermaid blocks; html: <file>.html with
        the SVGs. Refuses (exit 1) when the document has errors.`;

/** `proschi render`: parses `<file>`, refuses on errors, and writes the files of the chosen format. */
export async function renderCommand(args: string[], out: (s: string) => void, err: (s: string) => void, usage: string): Promise<number> {
  let dir = '.';
  let format: RenderFormat = 'svg';
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg === '-o') {
      const value = args[++i];
      if (!value) {
        err(`Missing directory after ${arg}`);
        return 2;
      }
      dir = value;
    } else if (arg === '--format') {
      const value = args[++i];
      if (!FORMATS.includes(value as RenderFormat)) {
        err(`Unknown format '${value ?? ''}'; use ${FORMATS.join(', ')}`);
        return 2;
      }
      format = value as RenderFormat;
    } else if (arg.startsWith('-')) {
      err(`Unknown option ${arg}\n\n${usage}`);
      return 2;
    } else files.push(arg);
  }
  if (files.length !== 1) {
    err(usage);
    return 2;
  }

  const file = files[0];
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (e) {
    err(String((e as Error).message));
    return 2;
  }
  const { diagram, diagnostics } = parse(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    for (const d of errors) err(`${file}:${d.line}:${d.col}: error: ${d.message}`);
    err(`Not rendered: ${errors.length} error(s). Fix them, then run proschi render again.`);
    return 1;
  }

  const rendered = await renderFiles(diagram, format, basename(file, extname(file)) || 'diagram');
  mkdirSync(dir, { recursive: true });
  for (const f of rendered) {
    const path = join(dir, f.name);
    writeFileSync(path, f.content);
    out(path);
  }
  return 0;
}
