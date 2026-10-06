import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Coins, Flame, Heart, Lock, Minus, Plus, RotateCcw, Trash2, X, Zap } from 'lucide-react';
import deck from 'virtual:practice-cards';
import { promptOf, type Card } from '../../learn/cards';
import { eyebrow, outlineButton, primaryButton } from '../../components/Playground/ui';
import { roleOf } from '../engine/board';
import { MAX_REPLICAS, MAX_SHARDS, REROLL_COST, SKIP_CARD_CASH, STREAK_MAX, TIERS, TICKS } from '../engine/rules';
import type { Breach, Forecast, NodeTick, WaveSummary } from '../engine/run';
import type { Board, BoardNode, CardDef, ComponentDef, ContractDef, EventDef, GameContent, ScenarioDef } from '../engine/types';
import { IconTile } from './gameIcons';
import { CATEGORY_TILE, ICON, RARITY_TILE, rps, usd } from './visual';

/**
 * The panels around the board: the forecast before planning, the heads-up
 * numbers, the palette, the inspector of a node, the wave's result and
 * debrief, the card draft, the contracts and the end-of-run report.
 */

const cardsById = new Map<string, Card>(deck.cards.map((c) => [c.id, c]));
const topicTitle = (id: string) => deck.topics.find((t) => t.id === id)?.title ?? id;


const panel = 'rounded-brutal border-bw-1 border-ink bg-surface shadow-brutal-sm';

/** "Learn more": review cards behind a lesson, linked to daily review of their topic. */
export function LearnLinks({ ids, max = 3 }: { ids: readonly string[]; max?: number }) {
  const cards = [...new Set(ids)].map((id) => cardsById.get(id)).filter((c): c is Card => !!c && !c.retired).slice(0, max);
  if (!cards.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {cards.map((c) => (
        <li key={c.id}>
          <a href={`#/review/${c.topic}`} className="inline-flex items-start gap-1.5 underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            <BookOpen size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
            <span>
              <span className="text-muted">{topicTitle(c.topic)}:</span> {promptOf(c).replace(/\s+/g, ' ').slice(0, 110)}
              {promptOf(c).length > 110 ? '…' : ''}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---- Heads-up display ----

export function Hud(props: { wave: number; waves: number; endless: boolean; cash: number; monthly?: number; trust: number; maxTrust: number; score: number; streak: number; streakStep: number; tick?: number; compact?: boolean }) {
  const mult = Math.min(STREAK_MAX, 1 + props.streakStep * props.streak);
  const trustShare = Math.max(0, Math.min(1, props.trust / props.maxTrust));
  if (props.compact) {
    // One line for the phone's dock: wave, cash, Trust, score, streak.
    return (
      <div className="flex items-center justify-between gap-2 text-sm font-semibold sf-count" role="status" aria-label="Run status">
        <span>
          W{props.wave + 1}
          <span className="text-muted">/{props.endless ? '∞' : props.waves}</span>
          {props.tick !== undefined && <span className="text-xs text-muted"> ·{Math.min(props.tick + 1, TICKS)}</span>}
        </span>
        <span className={props.cash < 0 ? 'text-fail' : ''}>
          {usd(props.cash)}
          {props.monthly !== undefined && <span className="text-xs font-normal text-muted"> −{usd(props.monthly)}</span>}
        </span>
        <span className="inline-flex items-center gap-1" aria-label={`Trust ${props.trust}`}>
          <Heart size={13} aria-hidden="true" className={trustShare < 0.3 ? 'text-fail' : 'text-pass'} />
          {props.trust}
        </span>
        <span>{props.score.toLocaleString('en-US')}</span>
        <span className={props.streak > 0 ? 'text-pop-pink' : 'text-muted'}>×{mult.toFixed(1)}</span>
      </div>
    );
  }
  return (
    <div className={`${panel} grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 px-3 py-2 text-sm`} role="status" aria-label="Run status">
      <div>
        <p className={eyebrow}>Wave</p>
        <p className="font-display font-extrabold text-lg sf-count">
          {props.wave + 1}
          <span className="text-muted text-sm">/{props.endless ? '∞' : props.waves}</span>
          {props.tick !== undefined && <span className="ml-1 text-xs text-muted">tick {Math.min(props.tick + 1, TICKS)}/{TICKS}</span>}
        </p>
      </div>
      <div>
        <p className={eyebrow}>Cash</p>
        <p className={`font-display font-extrabold text-lg sf-count ${props.cash < 0 ? 'text-fail' : ''}`}>
          {usd(props.cash)}
          {props.monthly !== undefined && <span className="ml-1 text-xs text-muted">−{usd(props.monthly)}/mo</span>}
        </p>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <p className={`${eyebrow} flex items-center gap-1`}>
          <Heart size={11} aria-hidden="true" /> Trust
        </p>
        <div className="mt-1 h-3 rounded-full border-bw-1 border-ink bg-paper overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={props.maxTrust} aria-valuenow={props.trust} aria-label="Trust">
          <div className={`h-full transition-[width] duration-d3 ${trustShare < 0.3 ? 'bg-fail' : trustShare < 0.6 ? 'bg-pop-yellow' : 'bg-pass'}`} style={{ width: `${trustShare * 100}%` }} />
        </div>
        <p className="text-xs text-muted sf-count">{props.trust}</p>
      </div>
      <div>
        <p className={eyebrow}>Score</p>
        <p className="font-display font-extrabold text-lg sf-count">{props.score.toLocaleString('en-US')}</p>
      </div>
      <div>
        <p className={`${eyebrow} flex items-center gap-1`}>
          <Flame size={11} aria-hidden="true" /> Uptime
        </p>
        <p className={`font-display font-extrabold text-lg sf-count ${props.streak > 0 ? 'text-pop-pink' : 'text-muted'}`}>×{mult.toFixed(1)}</p>
      </div>
    </div>
  );
}

// ---- Forecast ----

export function ForecastPanel({ forecast, scenario, events, act, collapsible, children }: { forecast: Forecast; scenario: ScenarioDef; events: Map<string, EventDef>; act?: string; collapsible?: boolean; children?: ReactNode }) {
  const max = Math.max(...forecast.multipliers);
  const [open, setOpen] = useState(true);
  return (
    <section className={`${panel} p-3`} aria-label="Forecast">
      {forecast.boss && (
        <div className="sf-hazard -mx-3 -mt-3 mb-3 h-2 rounded-t-[calc(var(--r-md)-2px)]" aria-hidden="true" />
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-extrabold text-lg">
          {forecast.boss && <span className="mr-1 rounded bg-fail px-1.5 py-0.5 text-xs text-white align-middle">BOSS</span>}
          Wave {forecast.wave + 1}
          {forecast.name ? `: ${forecast.name}` : ''}
        </h3>
        {collapsible && (
          <button type="button" className="text-sm font-semibold underline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'}
          </button>
        )}
        <svg viewBox={`0 0 ${forecast.multipliers.length * 10} 24`} className="h-6 w-24" aria-label={`Traffic curve: ${forecast.curve}`}>
          {forecast.multipliers.map((m, i) => (
            <rect key={i} x={i * 10 + 1} y={24 - (m / max) * 22} width={8} height={(m / max) * 22} fill={i === forecast.peakTick ? 'rgb(var(--c-pink))' : 'rgb(var(--c-ink) / 0.6)'} />
          ))}
        </svg>
      </div>
      {open && act && <p className="mt-1 text-sm text-muted">{act}</p>}
      <p className="mt-2 text-sm">
        Peak:{' '}
        {forecast.peak.map((p, i) => (
          <span key={p.key}>
            {i > 0 && ', '}
            <strong className="sf-count">{forecast.spread ? `${rps(p.low)}–${rps(p.high)}` : rps(p.rps)} rps</strong> {p.name}
          </span>
        ))}
        {forecast.spread > 0 && <span className="text-muted"> (a forecast: the real peak lands within ±{Math.round(forecast.spread * 100)}%; a load test tests the middle)</span>}
        {forecast.global > 0 && <span> · {Math.round(forecast.global * 100)}% of users far away</span>}
      </p>
      {open && forecast.requirements.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Requirements">
          {forecast.requirements.map((r) => (
            <li key={r} className="rounded border-bw-1 border-ink/40 bg-paper px-1.5 py-0.5 font-mono text-xs">
              {r}
            </li>
          ))}
          {forecast.freshness.map((f) => (
            <li key={f.useCase} className="rounded border-bw-1 border-ink/40 bg-paper px-1.5 py-0.5 font-mono text-xs">
              {scenario.useCases[f.useCase]?.name} background ≤ {f.maxMinutes} min
            </li>
          ))}
        </ul>
      )}
      {open && forecast.surprises && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
          <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
          Not every incident is on the forecast any more: some strike unannounced, and one that breaks something can set off another. Keep some headroom, and a hotfix or two in hand.
        </p>
      )}
      {open && forecast.events.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {forecast.events.map((e) => {
            const def = events.get(e.id);
            return (
            <li key={e.id} className="flex items-start gap-1.5">
              {def ? <IconTile name={def.icon} tone={CATEGORY_TILE[def.category]} size="sm" /> : <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-fail" />}
              <span>
                <strong>{e.title}</strong>
                {e.from !== undefined ? ` at tick ${e.from}${e.duration > 1 ? `–${e.from + e.duration - 1}` : ''}` : ''}: {e.telegraph}
                {def?.counters.length && scenario.mode === 'scale' ? <span className="text-muted"> (counters: {def.counters.join(', ')})</span> : null}
              </span>
            </li>
            );
          })}
        </ul>
      )}
      {children}
    </section>
  );
}

// ---- Palette ----

export interface PaletteItem {
  def: ComponentDef;
  available: boolean;
  full: boolean;
}

export function Palette({ items, placing, onPick, onDragStart, onPointerEnd }: { items: PaletteItem[]; placing?: string; onPick: (id: string) => void; onDragStart: (id: string, e: React.PointerEvent) => void; onPointerEnd?: () => void }) {
  const start = useRef<{ x: number; y: number }>(undefined);
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [touch-action:pan-x] [scrollbar-width:thin]" role="toolbar" aria-label="Components">
      {items.map(({ def, available, full }) => {
        const Icon = ICON[def.role];
        return (
          <button
            key={def.id}
            type="button"
            data-component={def.id}
            disabled={!available || full}
            aria-pressed={placing === def.id}
            title={available ? `${def.summary} (e.g. ${def.examples})` : `Unlock for ${def.unlock} Blueprints in the shop`}
            onClick={() => onPick(def.id)}
            onPointerDown={(e) => {
              start.current = { x: e.clientX, y: e.clientY };
              if (available && !full) onDragStart(def.id, e);
            }}
            onPointerMove={(e) => {
              // A swipe along the palette scrolls it: no drag.
              if (start.current && Math.abs(e.clientX - start.current.x) > 8) onPointerEnd?.();
            }}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-brutal border-bw-1 px-2.5 py-2 text-sm font-semibold transition-[transform,box-shadow] duration-d1 ${
              placing === def.id ? 'border-ink bg-pop-yellow text-on-accent shadow-brutal-sm -translate-y-0.5' : available ? 'border-ink bg-surface hover:shadow-brutal-sm' : 'border-ink/30 bg-paper text-muted'
            } disabled:cursor-not-allowed`}
          >
            {available ? <Icon size={15} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
            <span>{def.name}</span>
            {!available && <span className="text-xs">{def.unlock}◆</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---- Inspector ----

export interface InspectorProps {
  node: BoardNode;
  board: Board;
  content: GameContent;
  scenario: ScenarioDef;
  components: ReadonlyMap<string, ComponentDef>;
  unlocked: ReadonlySet<string>;
  useCases: string[];
  stats?: NodeTick;
  editable: boolean;
  wiring: boolean;
  onChange: (patch: Partial<BoardNode>) => void;
  onWire: () => void;
  onUnwire: (to: string) => void;
  onRemove: () => void;
  onClose: () => void;
  /** During the run: the on-call's actions on this node (more replicas, bring it back). */
  oncall?: { label: string; disabled: boolean; onClick: () => void }[];
  /** The phone's bottom sheet: the essentials first, the reading behind a tap. */
  compact?: boolean;
}

export function Inspector(p: InspectorProps) {
  const c = p.components.get(p.node.component);
  const external = p.scenario.externals.find((e) => e.id === p.node.component);
  const role = roleOf(p.node, p.components, p.scenario);
  const Icon = role ? ICON[role] : ICON.app;
  const fixed = role === 'users' || role === 'external';
  const tiersOk = p.unlocked.has('tiers') && !!c && ['app', 'worker', 'cache', 'db', 'search'].includes(c.role);
  const shardsOk = p.unlocked.has('shards') && c?.role === 'db';
  const out = p.board.edges.filter(([a]) => a === p.node.id).map(([, b]) => b);
  const name = (id: string) => {
    const n = p.board.nodes.find((x) => x.id === id);
    return n?.component === 'users' ? 'Users' : (p.scenario.externals.find((e) => e.id === n?.component)?.name ?? p.components.get(n?.component ?? '')?.name ?? id);
  };
  const stepper = (label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <div className="inline-flex items-center gap-1">
        <button type="button" className={outlineButton} aria-label={`Fewer ${label.toLowerCase()}`} disabled={!p.editable || value <= min} onClick={() => set(value - 1)}>
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="w-8 text-center font-mono font-bold sf-count" aria-live="polite">
          {value}
        </span>
        <button type="button" className={outlineButton} aria-label={`More ${label.toLowerCase()}`} disabled={!p.editable || value >= max} onClick={() => set(value + 1)}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
  return (
    <section className={`${panel} p-3 space-y-3`} aria-label={`${name(p.node.id)} settings`}>
      <div className="flex items-start gap-2">
        <Icon size={20} aria-hidden="true" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-extrabold">{name(p.node.id)}</h3>
          <p className="text-xs text-muted">{external ? `An external system: ${external.tech}. You call it; you cannot scale it.` : role === 'users' ? 'Where every request starts.' : c ? `e.g. ${c.examples}` : ''}</p>
        </div>
        <button type="button" className="p-1" aria-label="Close" onClick={p.onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {c && !p.compact && <p className="text-sm">{c.summary}</p>}
      {c && !p.compact && <p className="text-xs text-muted">{c.tradeoff}</p>}
      {p.stats && !fixed && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted">Busy</dt>
            <dd className={`font-mono font-bold ${p.stats.utilization >= 1 ? 'text-fail' : ''}`}>{p.stats.down ? 'down' : `${Math.round(p.stats.utilization * 100)}%`}</dd>
          </div>
          <div>
            <dt className="text-muted">Load</dt>
            <dd className="font-mono font-bold">
              {rps(p.stats.loadRps)}/{Number.isFinite(p.stats.capacityRps) ? rps(p.stats.capacityRps) : '∞'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Cost</dt>
            <dd className="font-mono font-bold">{usd(p.stats.costUsd)}/mo</dd>
          </div>
        </dl>
      )}
      {!fixed && (
        <div className="space-y-2">
          {stepper('Replicas', p.node.replicas, 1, MAX_REPLICAS, (v) => p.onChange({ replicas: v }))}
          {tiersOk && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Size</span>
              <div className="inline-flex gap-1" role="radiogroup" aria-label="Instance size">
                {TIERS.map((t, i) => (
                  <button
                    key={t.name}
                    type="button"
                    role="radio"
                    aria-checked={(p.node.tier ?? 0) === i}
                    disabled={!p.editable}
                    title={`${t.capacity}× capacity for ${t.cost}× the price`}
                    onClick={() => p.onChange({ tier: i })}
                    className={`w-9 rounded border-bw-1 border-ink py-1 text-sm font-bold ${(p.node.tier ?? 0) === i ? 'bg-pop-yellow text-on-accent' : 'bg-surface'}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {shardsOk && stepper('Shards', p.node.shards ?? 1, 1, MAX_SHARDS, (v) => p.onChange({ shards: v }))}
          {c?.role === 'app' && p.useCases.length > 1 && (
            <fieldset>
              <legend className="text-sm font-semibold">Handles</legend>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {p.useCases.map((k) => {
                  const handles = p.node.handles?.length ? p.node.handles : p.useCases;
                  return (
                    <label key={k} className="inline-flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        disabled={!p.editable}
                        checked={handles.includes(k)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...handles, k] : handles.filter((x) => x !== k);
                          p.onChange({ handles: next.length === p.useCases.length ? [] : next });
                        }}
                      />
                      {p.scenario.useCases[k]?.name ?? k}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}
      {role !== 'external' && (
        <div>
          <p className="text-sm font-semibold">Calls</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {out.map((to) => (
              <li key={to} className="inline-flex items-center gap-1 rounded border-bw-1 border-ink/40 px-1.5 py-0.5 text-xs">
                {name(to)}
                {p.editable && (
                  <button type="button" aria-label={`Unwire ${name(to)}`} onClick={() => p.onUnwire(to)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
            {out.length === 0 && <li className="text-xs text-muted">Nothing yet</li>}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {p.editable && role !== 'external' && (
          <button type="button" className={p.wiring ? primaryButton : outlineButton} onClick={p.onWire}>
            {p.wiring ? 'Tap a target… (done)' : 'Wire to…'}
          </button>
        )}
        {p.editable && !fixed && (
          <button type="button" className={outlineButton} onClick={p.onRemove}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        )}
        {!fixed &&
          p.oncall?.map((a) => (
            <button key={a.label} type="button" className={primaryButton} disabled={a.disabled} onClick={a.onClick}>
              <Zap size={14} aria-hidden="true" /> {a.label}
            </button>
          ))}
      </div>
      {c &&
        (p.compact ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">What it is for</summary>
            <p className="mt-1">{c.summary}</p>
            <p className="mt-1 text-xs text-muted">{c.tradeoff}</p>
            <LearnLinks ids={c.learn} max={2} />
          </details>
        ) : (
          <LearnLinks ids={c.learn} max={2} />
        ))}
    </section>
  );
}

// ---- Modal ----

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} max-h-[92dvh] overflow-y-auto rounded-t-brutal sm:rounded-brutal border-bw-2 border-ink bg-paper p-4 shadow-brutal-lg sf-stamp`}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display font-extrabold text-2xl">{title}</h2>
          {onClose && (
            <button type="button" className="p-1" aria-label="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

// ---- Wave result and debrief ----

const BREACH_TITLE: Record<Breach['kind'], string> = {
  latency: 'Too slow',
  availability: 'Not available enough',
  cost: 'Over budget',
  durability: 'Not durable',
  resilience: 'Would not survive a failure',
  drop: 'Requests dropped',
  unroutable: 'No route',
  freshness: 'Background work fell behind',
  consistency: 'Inconsistent reads',
  compat: 'Broke old clients',
  migration: 'Risky migration',
};

export function WaveResult({ summary, scenario, events, onContinue, children }: { summary: WaveSummary; scenario: ScenarioDef; events: Map<string, EventDef>; onContinue: () => void; children?: ReactNode }) {
  const lines: [string, number, string?][] = [
    ['Revenue', summary.revenue],
    ['Cloud bill', -summary.cost],
    ['Interest', summary.interest],
    ...(summary.leanCash ? ([['Right-sized refund', summary.leanCash]] as [string, number][]) : []),
  ];
  const debrief = summary.debrief ? scenario.sections[`Debrief: ${summary.debrief}`] : undefined;
  return (
    <Modal title={summary.clean ? `Wave ${summary.wave + 1}: clean!` : `Wave ${summary.wave + 1} debrief`} wide>
      <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
        <div>
          <dl className="space-y-1 text-sm">
            {lines.map(([k, v]) => (
              <div key={k} className="flex justify-between sf-card">
                <dt>{k}</dt>
                <dd className={`font-mono font-bold ${v < 0 ? 'text-fail' : ''}`}>{usd(v)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t-bw-1 border-ink/30 pt-1 sf-card">
              <dt>Points</dt>
              <dd className="font-mono font-bold">{summary.points.toLocaleString('en-US')}</dd>
            </div>
            {summary.leanBonus > 0 && (
              <div className="flex justify-between text-pass sf-card">
                <dt>Right-sized bonus</dt>
                <dd className="font-mono font-bold">+{summary.leanBonus.toLocaleString('en-US')}</dd>
              </div>
            )}
            {summary.bossBonus > 0 && (
              <div className="flex justify-between text-pop-pink sf-card">
                <dt>Boss beaten</dt>
                <dd className="font-mono font-bold">+{summary.bossBonus.toLocaleString('en-US')}</dd>
              </div>
            )}
            <div className="flex justify-between sf-card">
              <dt>Trust</dt>
              <dd className={`font-mono font-bold ${summary.trustDelta < 0 ? 'text-fail' : 'text-pass'}`}>
                {summary.trustDelta >= 0 ? '+' : ''}
                {summary.trustDelta}
                {summary.clean ? ' (+5 clean)' : ''}
                {summary.boss ? ' (+15 boss)' : ''}
              </dd>
            </div>
          </dl>
        </div>
        <div className="space-y-3 text-sm">
          {summary.demand !== undefined && Math.abs(summary.demand - 1) >= 0.01 && (
            <p className="text-muted">
              Real traffic was {Math.round(Math.abs(summary.demand - 1) * 100)}% {summary.demand > 1 ? 'above' : 'below'} the forecast.
            </p>
          )}
          {children}
          {summary.worst && <BreachCard breach={summary.worst} count={summary.breaches.filter((b) => b.kind === summary.worst!.kind).length} during={summary.events.map((e) => events.get(e.id)).filter((d): d is EventDef => !!d)} />}
          {summary.events.map((e) => {
            const def = events.get(e.id);
            if (!def) return null;
            return (
              <details key={e.id} className="rounded border-bw-1 border-ink/40 bg-surface p-2" open={!summary.clean}>
                <summary className="cursor-pointer font-semibold">
                  <span className="inline-flex items-center gap-1.5 align-middle">
                    <IconTile name={def.icon} tone={CATEGORY_TILE[def.category]} size="sm" />
                    {def.title}
                    {e.chained ? <span className="text-xs font-normal text-fail">set off by the incident before it</span> : e.surprise ? <span className="text-xs font-normal text-muted">unannounced</span> : null}
                  </span>
                </summary>
                <p className="mt-1">{def.whatHappened}</p>
                <p className="mt-1">
                  <strong>Why:</strong> {def.why}
                </p>
                <p className="mt-1">
                  <strong>What a senior engineer would do:</strong> {def.senior}
                </p>
                <LearnLinks ids={def.learn} max={2} />
              </details>
            );
          })}
          {debrief && (
            <div className="rounded border-bw-1 border-ink bg-pop-lilac/25 p-2">
              <p className={eyebrow}>Staff engineer’s note</p>
              <p className="mt-1">{debrief}</p>
            </div>
          )}
          {summary.clean && !summary.events.length && !debrief && <p>Everything held. Keep an eye on the next forecast.</p>}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className={primaryButton} onClick={onContinue} autoFocus>
          Continue <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}

/** A breach and its fix; `during` lists the incidents that were on when it happened. */
export function BreachCard({ breach, count, during }: { breach: Breach; count?: number; during?: readonly EventDef[] }) {
  return (
    <div className="rounded border-bw-1 border-ink bg-fail/10 p-2">
      <p className="flex items-center gap-1 font-semibold">
        <AlertTriangle size={15} aria-hidden="true" className="text-fail" />
        {BREACH_TITLE[breach.kind]}
        {count && count > 1 ? <span className="text-muted font-normal"> ×{count} ticks</span> : null}
      </p>
      <p className="mt-1">{breach.message}</p>
      {during && during.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          During:
          {during.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1 font-semibold text-ink">
              <IconTile name={d.icon} tone={CATEGORY_TILE[d.category]} size="sm" />
              {d.title}
            </span>
          ))}
        </p>
      )}
      {breach.hint && (
        <p className="mt-1">
          <strong>Fix:</strong> {breach.hint}
        </p>
      )}
      <LearnLinks ids={breach.learn} max={2} />
    </div>
  );
}

// ---- Draft ----

const RARITY_STYLE: Record<CardDef['rarity'], string> = {
  common: 'bg-surface',
  uncommon: 'bg-pop-blue/15',
  rare: 'bg-pop-lilac/30',
  legendary: 'bg-pop-yellow/50',
};

export function Draft({ offer, cash, rerollCost, onPick, onReroll }: { offer: CardDef[]; cash: number; rerollCost: number; onPick: (i: number | null) => void; onReroll: () => void }) {
  return (
    <Modal title="Pick a tech card" wide>
      <p className="text-sm text-muted">Cards last for the rest of the run. Skip for {usd(SKIP_CARD_CASH)}.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {offer.map((card, i) => (
          <li key={card.id} className="sf-card">
            <button type="button" onClick={() => onPick(i)} className={`h-full w-full text-left rounded-brutal border-bw-2 border-ink p-3 shadow-brutal-sm transition-transform duration-d1 hover:-translate-y-1 hover:shadow-brutal-md ${RARITY_STYLE[card.rarity]}`}>
              <span className="flex items-start gap-2">
                <IconTile name={card.icon} tone={RARITY_TILE[card.rarity]} size="lg" className="shadow-brutal-sm" />
                <span className="min-w-0">
                  <span className={`${eyebrow} block`}>
                    {card.rarity} · {topicTitle(card.topic)}
                  </span>
                  <span className="mt-0.5 block font-display font-extrabold text-lg leading-tight">{card.name}</span>
                </span>
              </span>
              <p className="mt-1 text-sm">{card.text}</p>
              <p className="mt-2 text-xs text-muted">{card.why.slice(0, 180)}{card.why.length > 180 ? '…' : ''}</p>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={outlineButton} disabled={cash < rerollCost} onClick={onReroll}>
          <RotateCcw size={14} aria-hidden="true" /> Reroll ({rerollCost === 0 ? 'free' : usd(rerollCost || REROLL_COST)})
        </button>
        <button type="button" className={outlineButton} onClick={() => onPick(null)}>
          <Coins size={14} aria-hidden="true" /> Skip (+{usd(SKIP_CARD_CASH)})
        </button>
      </div>
    </Modal>
  );
}

export function Contracts({ offer, scenario, onPick }: { offer: ContractDef[]; scenario: ScenarioDef; onPick: (i: number | null) => void }) {
  return (
    <Modal title="A contract is on the table" wide>
      <p className="text-sm text-muted">More use cases mean more revenue, and more to keep up.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {offer.map((c, i) => (
          <li key={c.id} className="sf-card">
            <button type="button" onClick={() => onPick(i)} className="h-full w-full text-left rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm hover:-translate-y-1 hover:shadow-brutal-md transition-transform duration-d1">
              <p className="font-display font-extrabold text-lg">{c.name}</p>
              <p className="mt-1 text-sm">{c.text}</p>
              {c.useCase && <p className="mt-2 text-xs text-muted">Adds “{scenario.useCases[c.useCase]?.name}”, about {c.rps} rps and growing.</p>}
              {c.requirements?.map((r) => (
                <p key={r} className="mt-1 font-mono text-xs">
                  {r}
                </p>
              ))}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button type="button" className={outlineButton} onClick={() => onPick(null)}>
          No thanks
        </button>
      </div>
    </Modal>
  );
}

// ---- Report ----

export function Timeline({ history, events }: { history: WaveSummary[]; events?: ReadonlyMap<string, EventDef> }) {
  const max = Math.max(1, ...history.flatMap((h) => [h.revenue, h.cost]));
  const w = 26;
  const met = events ? history.map((h, i) => ({ wave: i + 1, defs: h.events.map((e) => events.get(e.id)).filter((d): d is EventDef => !!d) })).filter((x) => x.defs.length) : [];
  return (
    <>
    <svg viewBox={`0 0 ${history.length * w + 4} 80`} className="w-full h-24" role="img" aria-label="Revenue and cost per wave">
      {history.map((h, i) => (
        <g key={i}>
          <rect x={i * w + 4} y={76 - (h.revenue / max) * 70} width={9} height={(h.revenue / max) * 70} fill="rgb(var(--c-pass))" />
          <rect x={i * w + 14} y={76 - (h.cost / max) * 70} width={9} height={(h.cost / max) * 70} fill="rgb(var(--c-fail) / 0.7)" />
          {h.boss && <text x={i * w + 13} y={8} fontSize={8} textAnchor="middle">★</text>}
          {!h.clean && <circle cx={i * w + 13} cy={78} r={2} fill="rgb(var(--c-fail))" />}
        </g>
      ))}
    </svg>
    {met.length > 0 && (
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="Incidents per wave">
        {met.map(({ wave, defs }) => (
          <li key={wave} className="inline-flex items-center gap-1">
            <span className="font-mono text-muted">W{wave}</span>
            {defs.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1" title={d.title}>
                <IconTile name={d.icon} tone={CATEGORY_TILE[d.category]} size="sm" />
                <span className="sr-only">{d.title}</span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    )}
    </>
  );
}

export function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className={`${panel} p-3`}>
      <p className={`${eyebrow} flex items-center gap-1`}>
        {icon}
        {label}
      </p>
      <p className="mt-1 font-display font-extrabold text-2xl sf-count">{value}</p>
    </div>
  );
}

export function Collapsible({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  const [isOpen, setOpen] = useState(!!open);
  return (
    <section className={`${panel} p-3`}>
      <button type="button" className="flex w-full items-center justify-between font-semibold" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        {title}
        <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </section>
  );
}
