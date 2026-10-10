import { toMermaidArchitecture, toMermaidSequence } from '../dsl/mermaid';
import {
  LOAD_HEADINGS,
  accessText,
  egressText,
  replicasText,
  totalCostText,
  formatMs,
  formatPercent,
  formatRps,
  formatUsd,
  overviewFacts,
  responseText,
  type CheckStatus,
  type HldDocument,
  type HldSection,
  type Risk,
} from './hld';

/**
 * The HLD as Markdown, with the architecture and every scenario as Mermaid
 * blocks (GitHub renders them). Used by "Download Markdown" in the editor and
 * `proschi render --format hld-md`.
 */

const STATUS: Record<CheckStatus, string> = { pass: '✅', fail: '❌', unchecked: '—' };
const SEVERITY: Record<Risk['severity'], string> = { high: '🔴', medium: '🟠', low: '⚪' };

/** Makes text safe inside a table cell: no pipes or line breaks. */
export function cell(text: string | number | undefined): string {
  return text === undefined || text === '' ? '—' : String(text).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ');
}

function table(head: string[], rows: (string | number | undefined)[][]): string[] {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`), ''];
}

const fence = (lang: string, code: string) => ['```' + lang, code.trimEnd(), '```', ''];
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

function renderSection(doc: HldDocument, s: HldSection): string[] {
  const out = [`## ${s.title}`, ''];
  switch (s.kind) {
    case 'overview': {
      if (s.summary) out.push(s.summary, '');
      out.push(overviewFacts(s), '');
      if (s.components) out.push(...fence('mermaid', toMermaidArchitecture(doc.diagram)));
      break;
    }
    case 'requirements': {
      if (s.functional.length) {
        out.push('### Functional', '');
        for (const f of s.functional) {
          out.push(`- **${f.name}**${f.description ? ` — ${f.description}` : ''}`);
          if (f.scenarios.length > 1 || f.scenarios[0]?.condition) {
            for (const sc of f.scenarios) out.push(`  - ${sc.name}${sc.outcome === 'error' ? ' (error)' : ''}${sc.condition ? ` — when ${sc.condition}` : ''}`);
          }
        }
        out.push('');
      }
      if (s.nonFunctional.length) {
        out.push('### Non-functional', '', ...table(['Requirement', 'Status', 'Measured'], s.nonFunctional.map((r) => [r.label, STATUS[r.status], r.measured])));
      }
      if (s.flowTests.length) {
        out.push('### Flow tests', '', ...table(['Test', 'Status', 'Asserts', 'Result'], s.flowTests.map((t) => [t.name, STATUS[t.status], t.assertions.map(code).join('<br>'), t.measured])));
      }
      break;
    }
    case 'capacity': {
      if (s.traffic.length) {
        out.push('### Traffic', '', ...table(['Use case', 'Rate', 'Mix'], s.traffic.map((t) => [t.useCase, formatRps(t.rps), t.mix.map((m) => `${m.scenario} ${formatPercent(m.share)}`).join(', ')])));
      }
      if (s.load.length) {
        out.push(
          '### Load per component',
          '',
          ...table(
            LOAD_HEADINGS,
            s.load.map((n) => [
              n.name,
              accessText(n, 'read'),
              accessText(n, 'write'),
              `${formatPercent(n.utilization)}${n.saturated ? ' ⚠️ saturated' : ''}`,
              replicasText(n),
              egressText(n),
              formatUsd(n.costUsd),
            ]),
          ),
        );
      }
      if (s.totalCostUsd !== undefined) out.push(`**Total cost:** ${totalCostText(s.totalCostUsd, s.totalEgressUsd)}`, '');
      break;
    }
    case 'components':
      out.push(
        ...table(
          ['Component', 'Tech', 'Kind', 'Team', 'Replicas', 'Responsibility', 'Stores'],
          s.components.map((c) => [`**${c.name}** (${code(c.id)})`, c.tech, c.kind, c.team, c.replicas, c.responsibility, c.entities.join(', ')]),
        ),
      );
      break;
    case 'dataModel':
      for (const e of s.entities) {
        out.push(`### ${e.name}${e.storeName ? ` (in ${e.storeName})` : ''}`, '');
        if (e.description) out.push(e.description, '');
        out.push(...table(['Field', 'Type', 'Flags'], e.fields.map((f) => [code(f.name), f.type, f.flags.join(', ')])));
      }
      break;
    case 'apis':
      for (const ep of s.endpoints) {
        out.push(`### ${code(ep.endpoint)}`, '');
        if (ep.service) out.push(`Served by ${ep.service}.`, '');
        for (const op of ep.operations) {
          out.push(`**${op.useCase}**${op.endpoint !== ep.endpoint ? ` — ${code(op.endpoint)}` : ''}`, '');
          if (op.request) out.push(...fence('json', op.request));
          out.push(...table(['Scenario', 'Response'], op.responses.map((r) => [`${r.scenario}${r.outcome === 'error' ? ' (error)' : ''}`, code(responseText(r))])));
        }
      }
      break;
    case 'scenarios':
      for (const u of s.useCases) {
        out.push(`### ${u.name}`, '');
        const about = [u.endpoint && code(u.endpoint), u.rps !== undefined && formatRps(u.rps), u.description].filter(Boolean).join(' · ');
        if (about) out.push(about, '');
        for (const sc of u.scenarios) {
          if (u.scenarios.length > 1) out.push(`#### ${sc.name}${sc.outcome === 'error' ? ' (error)' : ''}`, '');
          const facts = [
            sc.condition && `When ${sc.condition}`,
            sc.share !== undefined && `${formatPercent(sc.share)} of traffic`,
            sc.latency && `p50 ${formatMs(sc.latency.p50)}, p99 ${formatMs(sc.latency.p99)}`,
          ].filter(Boolean);
          if (facts.length) out.push(facts.join(' · '), '');
          if (sc.steps) out.push(...fence('mermaid', toMermaidSequence(doc.diagram, u.useCaseId, sc.id)));
        }
      }
      break;
    case 'decisions':
      for (const d of s.decisions) {
        out.push(`### ${d.title}`, '');
        if (d.because) out.push(`**Because** ${d.because}`, '');
        if (d.rejected.length) {
          out.push('Rejected:', '');
          for (const r of d.rejected) out.push(`- **${r.option}** — ${r.reason}`);
          out.push('');
        }
      }
      break;
    case 'risks':
      for (const r of s.risks) {
        out.push(`- ${SEVERITY[r.severity]} **${r.title}**${r.detail ? ` — ${r.detail}` : ''}${r.hint ? ` _Fix:_ ${r.hint}` : ''}`);
      }
      out.push('');
      break;
  }
  return out;
}

export function toMarkdown(doc: HldDocument): string {
  const out = [`# ${doc.title}`, ''];
  if (!doc.checked && doc.sections.some((s) => s.kind === 'requirements' && (s.nonFunctional.length || s.flowTests.length))) {
    out.push('> Requirements and tests were not checked: the simulation did not run.', '');
  }
  for (const s of doc.sections) out.push(...renderSection(doc, s));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
