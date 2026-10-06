/**
 * `proschi import mermaid|openapi <file>` converts a Mermaid diagram or an
 * OpenAPI spec to Proschi source, with the converters of the web editor's
 * Import dialog (frontend/src/dsl/importMermaid.ts, importOpenApi.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { fromMermaid } from '../../frontend/src/dsl/importMermaid';
import { openApiFromText } from '../../frontend/src/dsl/importOpenApi';

export const IMPORT_USAGE = `  proschi import mermaid|openapi <file> [-o <out.proschi>]`;

export const IMPORT_HELP = `import  Converts a Mermaid flowchart or sequence diagram (or Markdown with
        \`\`\`mermaid blocks), or an OpenAPI 3 spec (YAML or JSON), to Proschi
        source on stdout (or into -o). What cannot be converted is reported as
        warnings on stderr.`;

export function runImport(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  const [format, ...rest] = args;
  let file: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-o' || rest[i] === '--out') output = rest[++i];
    else if (rest[i].startsWith('-')) {
      err(`Unknown option ${rest[i]}\n\nUsage:\n${IMPORT_USAGE}`);
      return 2;
    } else if (file === undefined) file = rest[i];
    else {
      err(`Usage:\n${IMPORT_USAGE}`);
      return 2;
    }
  }
  if ((format !== 'mermaid' && format !== 'openapi') || !file || (output !== undefined && !output)) {
    err(`Usage:\n${IMPORT_USAGE}`);
    return 2;
  }

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    err(`Cannot read ${file}: ${(e as Error).message}`);
    return 2;
  }
  const result = format === 'mermaid' ? fromMermaid(text) : openApiFromText(text, (t) => parseYaml(t));
  for (const w of result.warnings) err(`${file}:${w.line ? `${w.line}:` : ''} warning: ${w.message}`);
  if (output) writeFileSync(output, result.source);
  else out(result.source.trimEnd());
  return 0;
}
