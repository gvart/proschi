import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problems } from '../practice/catalog';
import { problemResolver, SOLUTION_FILE } from '../practice/workspace';
import { accessOf } from './access';
import { examples } from './examples';
import { parse } from './parser';
import type { ParseOptions } from './types';

/**
 * Typed operations in steps on the bundled content. Run with
 * TYPED_STEPS_REPORT=<file> to write every step whose read/write flips
 * against the verb rule (`accessOf`) because its target's type lists the
 * operation, and every warning about a label, a status or a header, per
 * practice solution, given file and example.
 */
const documents: { name: string; source: string; options: ParseOptions }[] = [
  ...problems.flatMap((p) => [
    { name: `${p.id}/solution`, source: p.solution, options: { path: SOLUTION_FILE, resolve: problemResolver(p) } },
    { name: `${p.id}/given`, source: p.given, options: {} },
    ...(p.wrong ?? []).map((w) => ({ name: `${p.id}/wrong/${w.name}`, source: w.source, options: { path: SOLUTION_FILE, resolve: problemResolver(p) } })),
  ]),
  ...examples.map((e) => ({ name: `example ${e.id}`, source: e.source, options: {} })),
];

const TYPED = / has no (operation|status|header) /;

describe('typed steps on the bundled content', () => {
  it('covers the 40 problems', () => {
    expect(problems).toHaveLength(40);
  });

  it('reports flips and typed-step warnings', () => {
    const flips: string[] = [];
    const warnings: string[] = [];
    for (const { name, source, options } of documents) {
      const { diagram, diagnostics } = parse(source, options);
      const seen = new Set<string>();
      for (const u of diagram.useCases)
        for (const s of u.scenarios)
          for (const step of s.steps) {
            const old = accessOf(step.httpMethod || undefined, step.stepName);
            const key = `${step.loc.file ?? ''}:${step.loc.line}`;
            if (step.op && step.op.access !== old && !seen.has(key)) {
              seen.add(key);
              flips.push(`${name}\t${u.name}\t${step.fromServiceId} -> ${step.toServiceId} : ${step.stepName}\t${old} -> ${step.op.access}`);
            }
          }
      for (const d of diagnostics) if (TYPED.test(d.message)) warnings.push(`${name}:${d.line}\t${d.message}`);
    }
    if (process.env.TYPED_STEPS_REPORT) {
      writeFileSync(process.env.TYPED_STEPS_REPORT, `FLIPS ${flips.length}\n${flips.join('\n')}\n\nWARNINGS ${warnings.length}\n${warnings.join('\n')}\n`);
    }
    expect(flips.every((f) => f.length > 0)).toBe(true);
  });
});
