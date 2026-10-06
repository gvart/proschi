import type { Diagnostic } from '../../dsl/types';
import { compile } from '../engine/compile';
import { TIERS } from '../engine/rules';
import type { Breach, Game } from '../engine/run';
import type { Board, GameContent } from '../engine/types';

/**
 * A board as the whole Proschi document the simulation reads: the board
 * compiled with the scenario's use cases, the wave's peak traffic (and its
 * cache and CDN hit ratios) and the requirements in force. "Open in editor"
 * exports the run's final design this way, and the code pane's Compiled tab
 * shows the plan this way while you build it.
 */
export function exportSource(game: Game, content: GameContent, board: Board = game.state.board, heading?: string): string {
  const s = game.state;
  const components = new Map(content.components.map((c) => [c.id, c]));
  const compiled = compile(game.scenario, board, components, s.useCases, { down: [], writesDown: [], global: s.global > 0, bots: false });
  const peak = new Map(game.forecast().peak.map((p) => [p.key, p.rps]));
  const traffic: string[] = [];
  for (const [key, route] of Object.entries(compiled.routes)) {
    const uc = game.scenario.useCases[key];
    const rps = Math.round(peak.get(key) ?? 0);
    if (rps <= 0) continue;
    const hit = uc.cache ?? 0;
    const edge = route.cdn ? (uc.edge ?? 0) : 0;
    const shares = route.scenarios.map((p) => {
      if (p.edge === 'hit') return edge;
      const region = s.global > 0 ? (p.far ? s.global : 1 - s.global) : 1;
      const cache = p.cache === 'none' ? 1 : p.cache === 'hit' ? hit : p.cache === 'miss' ? 1 - hit : 0;
      return (1 - edge) * region * cache;
    });
    const mix = route.scenarios.length > 1 ? ` mix ${route.scenarios.map((p, i) => `"${p.name}" ${Math.round(shares[i] * 1000) / 10}%`).join(', ')}` : '';
    traffic.push(`  "${route.name}" ${rps} rps${mix}`);
  }
  const capacity = board.nodes.flatMap((n) => {
    const parts = [(n.tier ?? 0) > 0 ? `size ${TIERS[n.tier!].name}` : '', (n.shards ?? 1) > 1 ? `shards ${n.shards}` : ''].filter(Boolean);
    return parts.length ? [`  ${n.id} ${parts.join(' ')}`] : [];
  });
  const blocks = [
    traffic.length ? `traffic {\n${traffic.join('\n')}\n}` : '',
    s.requirements.length ? `requirements {\n${s.requirements.map((r) => `  ${r}`).join('\n')}\n}` : '',
    capacity.length ? `capacity {\n${capacity.join('\n')}\n}` : '',
  ].filter(Boolean);
  const [head, ...rest] = compiled.source.split('\n\n');
  return [heading ?? `// ${game.scenario.title}: your design after wave ${s.history.length}, from Scale or Fail.`, head, ...blocks, ...rest].join('\n\n');
}

/**
 * Breaches as editor warnings on the compiled document's lines: the node at
 * fault on its declaration, a missed limit on its requirement line, anything
 * else about a use case on its `usecase` line. One warning a line.
 */
export function breachDiagnostics(source: string, breaches: readonly Breach[], nameOfUseCase: (key: string) => string | undefined): Diagnostic[] {
  const lines = source.split('\n');
  const find = (test: (text: string) => boolean) => lines.findIndex(test);
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byLine = new Map<number, Diagnostic>();
  for (const b of breaches) {
    let at = -1;
    if (b.node) at = find((t) => new RegExp(`^\\s*${escape(b.node!)}\\s+"`).test(t));
    const name = b.useCase ? nameOfUseCase(b.useCase) : undefined;
    if (at < 0 && name && ['latency', 'availability', 'durability'].includes(b.kind)) {
      const measure = b.kind === 'latency' ? /^\s*p[\d.]+\s/ : new RegExp(`^\\s*${b.kind}\\s`);
      at = find((t) => measure.test(t) && t.includes(`"${name}"`));
    }
    if (at < 0 && b.kind === 'cost') at = find((t) => /^\s*cost\s*<=/.test(t));
    if (at < 0 && name) at = find((t) => t.startsWith(`usecase "${name}"`));
    if (at < 0 || byLine.has(at)) continue;
    const text = lines[at];
    const col = text.length - text.trimStart().length + 1;
    byLine.set(at, { severity: 'warning', message: b.hint ? `${b.message} ${b.hint}` : b.message, line: at + 1, col, length: Math.max(1, text.trim().length) });
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}
