import { useState } from 'react';
import { Flame, Gauge, PowerOff, Zap } from 'lucide-react';
import { outlineButton } from '../../components/Playground/ui';
import { ONCALL_ACTS } from '../engine/rules';
import type { Game } from '../engine/run';
import type { OncallAct } from '../engine/types';

/**
 * The on-call's menu during a wave's run: what to do while it is on fire,
 * paid in attention (a few actions a wave), and some in cash or Trust. Node
 * actions (one more replica, bring a lost node back) are in the node's
 * settings; these act on the whole system.
 */
export function OncallBar({ game, compact, onAct }: { game: Game; compact?: boolean; onAct: (act: OncallAct, useCase?: string) => void }) {
  const s = game.state;
  const m = s.mitigation;
  const [shedding, setShedding] = useState(false);
  const hasCache = s.board.nodes.some((n) => game.content.components.find((c) => c.id === n.component)?.role === 'cache');
  const can = (act: OncallAct) => s.oncallLeft >= ONCALL_ACTS[act].attention && s.cash >= ONCALL_ACTS[act].cash;
  const price = (act: OncallAct) => [ONCALL_ACTS[act].cash ? `$${ONCALL_ACTS[act].cash}` : '', ONCALL_ACTS[act].trust ? `−${ONCALL_ACTS[act].trust} Trust` : ''].filter(Boolean).join(', ');
  const live = s.useCases.filter((k) => !s.sunset.includes(k) && m.shed[k] === undefined);
  return (
    <div className="space-y-1.5" role="group" aria-label="On-call">
      <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
        <span className="inline-flex items-center gap-1 font-semibold" aria-label={`On-call attention: ${s.oncallLeft} left`}>
          <Zap size={14} aria-hidden="true" /> On-call
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {Array.from({ length: Math.max(s.oncallLeft, 0) }, (_, i) => (
              <span key={i} className="inline-block h-2.5 w-2.5 rounded-full border border-ink bg-pop-yellow" />
            ))}
            {s.oncallLeft === 0 && <span className="text-muted">none left</span>}
          </span>
        </span>
        <button type="button" className={outlineButton} disabled={!can('ratelimit') || m.ratelimit !== undefined} onClick={() => onAct('ratelimit')} title="Turn away 15% of requests and every bot at the edge, for the rest of the wave">
          <Gauge size={14} aria-hidden="true" /> {m.ratelimit !== undefined ? 'Rate-limited' : `Rate limit${compact ? '' : ` (${price('ratelimit')})`}`}
        </button>
        {hasCache && (
          <button type="button" className={outlineButton} disabled={!can('warm') || m.warm !== undefined} onClick={() => onAct('warm')} title="Pre-load the hot keys: a cold cache is warm again from the next tick">
            <Flame size={14} aria-hidden="true" /> {m.warm !== undefined ? 'Cache warm' : `Warm the cache${compact ? '' : ` (${price('warm')})`}`}
          </button>
        )}
        <button type="button" className={outlineButton} aria-expanded={shedding} disabled={!can('shed') || !live.length} onClick={() => setShedding((x) => !x)} title="Switch a feature off for the rest of the wave: its load and its revenue are gone">
          <PowerOff size={14} aria-hidden="true" /> Switch a feature off{compact ? '' : ` (${price('shed')})`}
        </button>
      </div>
      {shedding && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Features to switch off">
          {live.map((k) => (
            <li key={k}>
              <button
                type="button"
                className={outlineButton}
                onClick={() => {
                  setShedding(false);
                  onAct('shed', k);
                }}
              >
                {game.scenario.useCases[k].name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
