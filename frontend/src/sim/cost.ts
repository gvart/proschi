import type { CostScope, Diagram, DiagramNode } from '../dsl/types';
import type { Analysis } from './analyze';

/**
 * Who pays for what: the monthly cost of the analysis split by owning team,
 * by group and by legend tag (docs/TESTS.md, "Budgets per team, group or tag").
 * A node counts for its own team, for every group it is inside (nested
 * groups included) and for its own tag and the tags of those groups.
 */

export interface CostShare {
  /** `@Payments`, a group id or `.edge`. */
  id: string;
  /** The group's or legend entry's name; the id for a team. */
  label: string;
  /** Instances and egress per month. */
  costUsd: number;
  egressUsd: number;
  /** The nodes it covers, the most expensive first. */
  nodes: string[];
}

export interface CostBreakdown {
  /** By owning team, the most expensive first. */
  teams: CostShare[];
  groups: CostShare[];
  tags: CostShare[];
  /** Nodes with no team: what the team rows leave out of the total. Absent when every costed node has a team. */
  unowned?: CostShare;
  totalCostUsd: number;
}

/** The groups a node is inside, the innermost first. */
function ancestors(byId: Map<string, DiagramNode>, node: DiagramNode): DiagramNode[] {
  const out: DiagramNode[] = [];
  for (let p = node.parent ? byId.get(node.parent) : undefined; p && !out.includes(p); p = p.parent ? byId.get(p.parent) : undefined) out.push(p);
  return out;
}

function covers(byId: Map<string, DiagramNode>, node: DiagramNode, scope: CostScope): boolean {
  if ('team' in scope) return node.ownerTeam === scope.team;
  const outer = ancestors(byId, node);
  if ('tag' in scope) return node.tag === scope.tag || outer.some((g) => g.tag === scope.tag);
  return outer.some((g) => g.id === scope.group);
}

/** The cost of the nodes a scoped budget covers. */
export function scopedCost(diagram: Diagram, analysis: Analysis, scope: CostScope): CostShare {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const nodes = analysis.nodes.filter((n) => {
    const node = byId.get(n.id);
    return node !== undefined && covers(byId, node, scope);
  });
  const id = 'team' in scope ? `@${scope.team}` : 'tag' in scope ? `.${scope.tag}` : scope.group;
  const label = 'team' in scope ? id : 'tag' in scope ? (diagram.legend?.find((e) => e.id === scope.tag)?.label ?? id) : (byId.get(scope.group)?.name ?? id);
  return share(id, label, nodes);
}

function share(id: string, label: string, nodes: Analysis['nodes']): CostShare {
  const sorted = [...nodes].sort((a, b) => b.costUsd - a.costUsd || a.id.localeCompare(b.id));
  return {
    id,
    label,
    costUsd: sorted.reduce((sum, n) => sum + n.costUsd, 0),
    egressUsd: sorted.reduce((sum, n) => sum + n.egressUsd, 0),
    nodes: sorted.map((n) => n.id),
  };
}

const byCost = (a: CostShare, b: CostShare) => b.costUsd - a.costUsd || a.id.localeCompare(b.id);

/** The cost of every team, group and tag the design names. Empty lists when it names none. */
export function costBreakdown(diagram: Diagram, analysis: Analysis): CostBreakdown {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const costed = analysis.nodes.filter((n) => byId.has(n.id));
  const teams = [...new Set(costed.map((n) => byId.get(n.id)!.ownerTeam).filter((t): t is string => t !== undefined))];
  const groups = diagram.nodes.filter((n) => n.kind === 'group');
  const tags = [...new Set(diagram.nodes.map((n) => n.tag).filter((t): t is string => t !== undefined))];
  const unowned = costed.filter((n) => byId.get(n.id)!.ownerTeam === undefined && n.costUsd > 0);
  return {
    teams: teams.map((team) => scopedCost(diagram, analysis, { team })).sort(byCost),
    groups: groups.map((g) => scopedCost(diagram, analysis, { group: g.id })).filter((s) => s.nodes.length > 0).sort(byCost),
    tags: tags.map((tag) => scopedCost(diagram, analysis, { tag })).filter((s) => s.nodes.length > 0).sort(byCost),
    ...(teams.length && unowned.length ? { unowned: share('no team', 'No team', unowned) } : {}),
    totalCostUsd: analysis.totalCostUsd,
  };
}
