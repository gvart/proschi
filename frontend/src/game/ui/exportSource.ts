import { compile } from '../engine/compile';
import type { Game } from '../engine/run';
import type { GameContent } from '../engine/types';

/**
 * The run's final design as a Proschi document, for "Open in editor": the
 * board compiled as the game ran it, with the last wave's peak traffic (and
 * its cache and CDN hit ratios) and the requirements in force.
 */
export function exportSource(game: Game, content: GameContent): string {
  const s = game.state;
  const components = new Map(content.components.map((c) => [c.id, c]));
  const compiled = compile(game.scenario, s.board, components, s.useCases, { down: [], writesDown: [], global: s.global > 0, bots: false });
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
  const shards = s.board.nodes.filter((n) => (n.shards ?? 1) > 1).map((n) => `  ${n.id} shards ${n.shards}`);
  const blocks = [
    traffic.length ? `traffic {\n${traffic.join('\n')}\n}` : '',
    s.requirements.length ? `requirements {\n${s.requirements.map((r) => `  ${r}`).join('\n')}\n}` : '',
    shards.length ? `capacity {\n${shards.join('\n')}\n}` : '',
  ].filter(Boolean);
  const [head, ...rest] = compiled.source.split('\n\n');
  return [`// ${game.scenario.title}: your design after wave ${s.history.length}, from Scale or Fail.`, head, ...blocks, ...rest].join('\n\n');
}
