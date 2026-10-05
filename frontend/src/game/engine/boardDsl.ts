import { parse } from '../../dsl/parser';
import type { Diagnostic, InstanceSize } from '../../dsl/types';
import { TIERS } from './rules';
import { USERS } from './compile';
import type { Board, BoardNode, ComponentDef, ScenarioDef } from './types';

/**
 * The board as a short Proschi document, and back, for the Arcade's code
 * pane: one line per component (`api "App Server" [Service] x3`), one per
 * wire, and a `capacity` block for sizes and shards. Only the board is
 * written here: the use cases and requirements come from the scenario. Which
 * use cases an app server handles has no syntax, so it is kept from the
 * board the text was written from.
 */

const USERS_TECH = 'Actor';
const SIZE_OF_TIER: InstanceSize[] = TIERS.map((t) => t.name);

interface Context {
  components: ReadonlyMap<string, ComponentDef>;
  scenario: ScenarioDef;
}

function nameOf(node: BoardNode, { components, scenario }: Context): { name: string; tech: string } {
  if (node.component === USERS) return { name: 'Users', tech: USERS_TECH };
  const external = scenario.externals.find((e) => e.id === node.component);
  if (external) return { name: external.name, tech: external.tech };
  const c = components.get(node.component);
  return { name: c?.name ?? node.component, tech: c?.tech ?? node.component };
}

const quote = (text: string) => `"${text.replace(/[\\"]/g, '\\$&')}"`;

export function boardToDsl(board: Board, ctx: Context): string {
  const width = Math.max(...board.nodes.map((n) => n.id.length));
  const pad = (id: string) => id.padEnd(width);
  const lines = board.nodes.map((n) => {
    const { name, tech } = nameOf(n, ctx);
    const fixed = n.component === USERS || ctx.scenario.externals.some((e) => e.id === n.component);
    return `${pad(n.id)} ${quote(name)} [${tech}]${!fixed && n.replicas > 1 ? ` x${n.replicas}` : ''}`;
  });
  const wires = board.edges.map(([a, b]) => `${pad(a)} -> ${b}`);
  const capacity = board.nodes.flatMap((n) => {
    const parts = [(n.tier ?? 0) > 0 ? `size ${SIZE_OF_TIER[n.tier!]}` : '', (n.shards ?? 1) > 1 ? `shards ${n.shards}` : ''].filter(Boolean);
    return parts.length ? [`  ${n.id} ${parts.join(' ')}`] : [];
  });
  return [
    '# Your board: components, wires, replicas (x3), sizes and shards.',
    '# The use cases and requirements come from the scenario.',
    '',
    ...lines,
    '',
    ...wires,
    ...(capacity.length ? ['', 'capacity {', ...capacity, '}'] : []),
    '',
  ].join('\n');
}

export interface DslBoard {
  /** The board the text describes; undefined while the text has errors. */
  board?: Board;
  /** Parser errors and what the text asks for that the game does not allow, as editor diagnostics. */
  diagnostics: Diagnostic[];
}

/** Reads the board back. `previous` supplies what the text cannot say (app servers' handled use cases). */
export function dslToBoard(source: string, ctx: Context & { previous: Board; unlocked: ReadonlySet<string> }): DslBoard {
  const { diagram, diagnostics } = parse(source);
  const problems: Diagnostic[] = diagnostics.filter((d) => d.severity === 'error');
  const error = (message: string, loc: { line: number; col: number; length: number }) => problems.push({ severity: 'error', message, ...loc });

  const byTech = new Map<string, string>();
  for (const c of ctx.components.values()) byTech.set(c.tech.toLowerCase(), c.id);
  for (const e of ctx.scenario.externals) byTech.set(e.tech.toLowerCase(), e.id);
  byTech.set(USERS_TECH.toLowerCase(), USERS);

  if (diagram.useCases.length) error('Use cases come from the scenario; the code here is the board only.', diagram.useCases[0].loc);
  const caps = new Map((diagram.capacity ?? []).map((c) => [c.node, c]));
  const nodes: BoardNode[] = [];
  for (const n of diagram.nodes) {
    if (n.kind === 'group' || n.kind === 'text') {
      error('Groups and notes are not part of a board.', n.loc);
      continue;
    }
    const component = n.implicit ? ctx.previous.nodes.find((p) => p.id === n.id)?.component : byTech.get(n.techStack.toLowerCase());
    if (!component) {
      error(n.implicit ? `'${n.id}' is not on the board: declare it with a tech, e.g. ${n.id} [Cache]` : `No component is a ${n.techStack}. Use one from the palette, e.g. [Cache].`, n.loc);
      continue;
    }
    const def = ctx.components.get(component);
    if (def && def.unlock > 0 && !ctx.unlocked.has(def.id)) {
      error(`${def.name} is locked: unlock it in the shop first.`, n.loc);
      continue;
    }
    const cap = caps.get(n.id);
    const tier = cap?.size ? SIZE_OF_TIER.indexOf(cap.size) : 0;
    const prev = ctx.previous.nodes.find((p) => p.id === n.id && p.component === component);
    nodes.push({
      id: n.id,
      component,
      replicas: n.replicas ?? 1,
      ...(tier > 0 ? { tier } : {}),
      ...((cap?.shards ?? 1) > 1 ? { shards: cap!.shards } : {}),
      ...(prev?.handles?.length ? { handles: prev.handles } : {}),
    });
  }
  for (const c of diagram.capacity ?? []) {
    const other = Object.keys(c).filter((k) => !['node', 'loc', 'size', 'shards'].includes(k));
    if (other.length) error('Only size and shards can be set here; the rest comes from the component and your cards.', c.loc);
  }
  for (const fixed of ctx.previous.nodes.filter((p) => p.component === USERS || ctx.scenario.externals.some((e) => e.id === p.component))) {
    if (!nodes.some((n) => n.component === fixed.component)) error(`${nameOf(fixed, ctx).name} must stay on the board.`, { line: 1, col: 1, length: 1 });
  }
  if (problems.length) return { diagnostics: problems };
  return { board: { nodes, edges: diagram.edges.map((e) => [e.source, e.target]) }, diagnostics: [] };
}
