import type { Diagram, DiagramNode } from './types';
import { buildSequence, findScenario, type SequenceMessage } from './sequence';

/**
 * Mermaid source for a diagram: a flowchart of the architecture and a sequence
 * diagram per scenario. Pure string building, shared by the web editor's
 * "Copy Mermaid" items and `proschi render --format md`.
 */

// Words Mermaid reads as keywords, so they cannot be used as plain ids.
const RESERVED = new Set(
  [
    'end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'linkstyle', 'direction', 'default',
    'participant', 'actor', 'as', 'note', 'over', 'left', 'right', 'of', 'loop', 'alt', 'else', 'opt', 'par', 'and',
    'rect', 'critical', 'break', 'option', 'activate', 'deactivate', 'autonumber', 'title', 'box', 'create', 'destroy',
    'link', 'links', 'properties', 'details', 'sequencediagram', 'accTitle', 'accDescr',
  ].map((w) => w.toLowerCase()),
);

/**
 * Makes text safe as a Mermaid message or label: characters with a meaning in
 * Mermaid (`#` entity codes, `;` statement ends, `%%` comments, `<>` HTML, and
 * with `quoted` also `"`) become entity codes, and line breaks become spaces.
 */
export function escapeMermaid(text: string, quoted = false): string {
  return text
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(quoted ? /[#;%<>"]/g : /[#;%<>]/g, (c) => `#${c.charCodeAt(0)};`)
    .trim();
}

/** Maps diagram ids to Mermaid-safe ids: reserved words get a `_` suffix. */
function idMapper(): (id: string) => string {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  return (id) => {
    let safe = ids.get(id);
    if (safe) return safe;
    safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !RESERVED.has(id.toLowerCase()) ? id : `${id.replace(/\W/g, '_')}_`;
    while (taken.has(safe)) safe += '_';
    ids.set(id, safe);
    taken.add(safe);
    return safe;
  };
}

function arrow(message: SequenceMessage): string {
  if (message.kind === 'response') return '-->>';
  if (message.failed) return '-x';
  return message.async ? '-)' : '->>';
}

/**
 * A `sequenceDiagram` for one scenario of a use case (the first scenario when
 * `scenarioId` is omitted). Returns an empty string for an unknown use case.
 */
export function toMermaidSequence(diagram: Diagram, useCaseId: string, scenarioId?: string): string {
  const found = findScenario(diagram, useCaseId, scenarioId);
  if (!found) return '';
  const sequence = buildSequence(found.useCase, found.scenario, diagram.nodes);
  const id = idMapper();
  const lines = ['sequenceDiagram', `  title ${escapeMermaid(found.useCase.name)}`];

  for (const p of sequence.participants) {
    const keyword = diagram.nodes.find((n) => n.id === p.id)?.techStack === 'Actor' ? 'actor' : 'participant';
    lines.push(`  ${keyword} ${id(p.id)} as ${escapeMermaid(p.name) || id(p.id)}`);
  }

  const first = sequence.participants[0];
  const last = sequence.participants.at(-1);
  if (first && last && (found.useCase.scenarios.length > 1 || sequence.condition)) {
    const over = first === last ? id(first.id) : `${id(first.id)},${id(last.id)}`;
    const outcome = found.scenario.outcome === 'error' ? ' (error)' : '';
    const when = sequence.condition ? ` when ${sequence.condition}` : '';
    lines.push(`  Note over ${over}: ${escapeMermaid(`${found.scenario.name}${outcome}${when}`)}`);
  }

  const message = (m: SequenceMessage, indent: string) =>
    `${indent}${id(m.from)}${arrow(m)}${id(m.to)}: ${escapeMermaid(m.label) || '#32;'}`;
  for (const item of sequence.items) {
    if (item.kind === 'message') {
      lines.push(message(item.message, '  '));
      continue;
    }
    item.branches.forEach((branch, i) => {
      lines.push(i === 0 ? '  par' : '  and');
      branch.forEach((m) => lines.push(message(m, '    ')));
    });
    lines.push('  end');
  }
  return lines.join('\n') + '\n';
}

function nodeLabel(node: DiagramNode): string {
  if (node.kind === 'text') return escapeMermaid(node.description ?? node.name, true);
  const tech = node.implicit ? '' : `<br/>[${escapeMermaid(node.techStack, true)}]`;
  return `${escapeMermaid(node.name, true)}${tech}`;
}

function nodeShape(node: DiagramNode, label: string): string {
  if (node.kind === 'text') return `>"${label}"]`;
  switch (node.type) {
    case 'database':
      return `[("${label}")]`;
    case 'queue':
      return `[["${label}"]]`;
    default:
      return `["${label}"]`;
  }
}

/** A left-to-right `flowchart` of the nodes, groups (as subgraphs) and connections. */
export function toMermaidArchitecture(diagram: Diagram): string {
  const id = idMapper();
  const lines = ['flowchart LR'];
  if (diagram.title) lines.splice(0, 0, '---', `title: ${JSON.stringify(diagram.title)}`, '---');

  const children = new Map<string | undefined, DiagramNode[]>();
  const known = new Set(diagram.nodes.map((n) => n.id));
  for (const node of diagram.nodes) {
    const parent = node.parent && known.has(node.parent) ? node.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const write = (parent: string | undefined, indent: string) => {
    for (const node of children.get(parent) ?? []) {
      if (node.kind === 'group') {
        lines.push(`${indent}subgraph ${id(node.id)}["${escapeMermaid(node.name, true)}"]`);
        write(node.id, `${indent}  `);
        lines.push(`${indent}end`);
      } else {
        lines.push(`${indent}${id(node.id)}${nodeShape(node, nodeLabel(node))}`);
      }
    }
  };
  write(undefined, '  ');

  for (const edge of diagram.edges) {
    const label = edge.label ? `|"${escapeMermaid(edge.label, true)}"|` : '';
    // Spaces around the arrow keep ids starting with `o` or `x` from reading as other arrow types.
    lines.push(`  ${id(edge.source)} -->${label} ${id(edge.target)}`);
  }
  return lines.join('\n') + '\n';
}
