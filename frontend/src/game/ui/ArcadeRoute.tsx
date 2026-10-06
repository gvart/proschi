import { useEffect, useMemo, useState } from 'react';
import { Boxes, CalendarDays, Gem, Lock, Medal, Play, ShoppingBag, Sparkles, Trophy, Wrench, type LucideIcon } from 'lucide-react';
import { api, apiEnabled } from '../../services/api';
import type { Account } from '../../practice/useAccount';
import { PROVIDER_LABEL } from '../../practice/account';
import { eyebrow, outlineButton, primaryButton } from '../../components/Playground/ui';
import { gameContent } from '../content';
import { maxAscension, scenarioOpen, shop, type ShopItem } from '../engine/meta';
import { ASCENSIONS, ascensionRules } from '../engine/rules';
import type { Action, RunSetup } from '../engine/types';
import { IconTile } from './gameIcons';
import { COMPONENT_TILE, FEATURE_ICON, FEATURE_TILE, ICON, MODE_ICON, MODE_LABEL, PERK_TILE, RARITY_TILE } from './visual';
import { Modal } from './Panels';
import RunScreen from './RunScreen';
import { loadRun, loadSettings, saveRun, saveSettings, type Settings } from './store';
import { useArcade } from './useArcade';
import './arcade.css';

/**
 * The Arcade tab of Interview prep (`#/arcade`): Scale or Fail. The home
 * screen has today's daily run, the scenarios (locked ones say what opens
 * them, cleared ones offer the next difficulty), the shop where Blueprints
 * buy components, cards and perks, and the leaderboards. A run in progress
 * survives a reload.
 */

interface Playing {
  setup: RunSetup;
  runId?: string;
  resume?: Action[];
  key: number;
}

export default function ArcadeRoute({ account }: { account: Account }) {
  const { content, errors } = gameContent();
  const arcade = useArcade(content, account.state);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [playing, setPlaying] = useState<Playing>();
  const [saved, setSaved] = useState(() => loadRun());
  const [shopOpen, setShopOpen] = useState(false);
  const [ascension, setAscension] = useState<Record<string, number>>({});
  const [starting, setStarting] = useState<string>();
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    document.title = 'Scale or Fail: the system design game · Proschi';
  }, []);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  const begin = async (key: string, opts: { mode: 'normal' | 'daily'; scenario?: string; ascension?: number }) => {
    setStarting(key);
    setStartError(undefined);
    try {
      const { setup, runId } = await arcade.start(opts);
      saveRun({ setup, actions: [], ...(runId ? { runId } : {}) });
      setPlaying({ setup, runId, key: Date.now() });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not start the run');
    } finally {
      setStarting(undefined);
    }
  };

  if (playing) {
    return (
      <RunScreen
        key={playing.key}
        content={content}
        setup={playing.setup}
        runId={playing.runId}
        resume={playing.resume}
        arcade={arcade}
        settings={settings}
        onSettings={updateSettings}
        onExit={() => {
          setSaved(loadRun());
          setPlaying(undefined);
        }}
        onAgain={() => {
          const { setup } = playing;
          setPlaying(undefined);
          void begin(setup.scenario, setup.mode === 'daily' ? { mode: 'normal', scenario: setup.scenario } : { mode: 'normal', scenario: setup.scenario, ascension: setup.ascension });
        }}
      />
    );
  }

  const meta = arcade.meta;
  const daily = content.scenarios.find((s) => s.id === arcade.daily.scenario);
  const signedOut = account.state.status === 'signed-out' ? account.state : undefined;
  const equippedPerks = meta.equipped.map((id) => content.perks.find((p) => p.id === id)).filter((p) => p !== undefined);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={eyebrow}>The system design game</p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold leading-none">Scale or Fail</h1>
          <p className="mt-2 max-w-xl text-sm">
            Build the system, then keep it up while traffic grows, new use cases arrive and things break. Every number comes from Proschi’s simulation, and every failure tells you why.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {equippedPerks.length > 0 && (
            <ul className="flex items-center gap-1" aria-label="Equipped perks">
              {equippedPerks.map((p) => (
                <li key={p.id} title={p.name}>
                  <IconTile name={p.icon} tone={PERK_TILE} size="lg" className="shadow-brutal-sm" />
                  <span className="sr-only">{p.name}</span>
                </li>
              ))}
            </ul>
          )}
          <span className="inline-flex items-center gap-1 rounded-brutal border-bw-1 border-ink bg-surface px-2.5 py-1.5 font-display font-extrabold shadow-brutal-sm" title="Blueprints: earned by runs, spent in the shop">
            <Gem size={15} aria-hidden="true" className="text-pop-blue" /> {meta.blueprints}
          </span>
          <button type="button" className={primaryButton} onClick={() => setShopOpen(true)}>
            <ShoppingBag size={14} aria-hidden="true" /> Shop
          </button>
        </div>
      </header>

      {errors.length > 0 && <p className="text-sm text-fail">Some game content did not load: {errors[0].message}</p>}
      {arcade.error && <p className="text-sm text-fail">{arcade.error}</p>}
      {startError && <p className="text-sm text-fail">{startError}</p>}
      {signedOut && apiEnabled && (
        <p className="text-sm text-muted">
          Signed out, your progress stays in this browser and runs are not ranked.{' '}
          {signedOut.providers.map((p) => (
            <button key={p} type="button" className="underline font-semibold text-ink mr-2" onClick={() => account.signIn(p)}>
              Sign in with {PROVIDER_LABEL[p]}
            </button>
          ))}
        </p>
      )}

      {saved && (
        <div className="rounded-brutal border-bw-2 border-ink bg-pop-yellow/30 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            You have a run of <strong>{content.scenarios.find((s) => s.id === saved.setup.scenario)?.title}</strong> in progress.
          </p>
          <div className="flex gap-2">
            <button type="button" className={primaryButton} onClick={() => setPlaying({ setup: saved.setup, runId: saved.runId, resume: saved.actions, key: Date.now() })}>
              <Play size={14} aria-hidden="true" /> Carry on
            </button>
            <button
              type="button"
              className={outlineButton}
              onClick={() => {
                saveRun(undefined);
                setSaved(undefined);
              }}
            >
              Abandon
            </button>
          </div>
        </div>
      )}

      {daily && (
        <section className="rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`${eyebrow} flex items-center gap-1`}>
                <CalendarDays size={12} aria-hidden="true" /> Daily run · {arcade.daily.day}
              </p>
              <h3 className="font-display text-2xl font-extrabold">{daily.title}</h3>
              <p className="text-sm text-muted">Same scenario and incidents for everyone today. One try counts.</p>
            </div>
            {arcade.daily.played ? (
              <p className="font-display text-xl font-extrabold">
                {arcade.daily.score?.toLocaleString('en-US') ?? 'Played'}
                <span className="block text-xs font-normal text-muted">come back tomorrow</span>
              </p>
            ) : (
              <button type="button" className={primaryButton} disabled={!!starting || arcade.busy} onClick={() => void begin('daily', { mode: 'daily' })}>
                <Play size={14} aria-hidden="true" /> {starting === 'daily' ? 'Starting…' : 'Play today’s run'}
              </button>
            )}
          </div>
        </section>
      )}

      <section>
        <h3 className="font-display text-2xl font-extrabold">Scenarios</h3>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {content.scenarios.map((s) => {
            const open = scenarioOpen(s, meta, (id) => content.scenarios.find((x) => x.id === id)?.title ?? id);
            const top = maxAscension(meta, s.id);
            const asc = Math.min(ascension[s.id] ?? top, top);
            const reached = meta.scenarios[s.id];
            return (
              <li key={s.id} className={`rounded-brutal border-bw-2 border-ink p-4 ${open.open ? 'bg-surface shadow-brutal-sm' : 'bg-paper border-dashed'}`}>
                <p className={`${eyebrow} flex items-center gap-1.5`}>
                  <IconTile name={MODE_ICON[s.mode]} tone={s.mode === 'scale' ? 'bg-paper' : 'bg-pop-yellow text-on-accent'} size="sm" />
                  {MODE_LABEL[s.mode]} · {s.difficulty} · {s.tags.slice(0, 2).join(', ')}
                </p>
                <h4 className="mt-1 font-display text-xl font-extrabold flex items-center gap-1.5">
                  {!open.open && <Lock size={16} aria-hidden="true" />}
                  {s.title}
                </h4>
                <p className="mt-1 text-sm">{s.summary}</p>
                {reached && (
                  <p className="mt-2 text-xs text-muted">
                    Best wave {reached.reached}/{s.waves.length}{reached.cleared >= 0 ? ` · cleared up to ascension ${reached.cleared}` : ''}
                  </p>
                )}
                {open.open ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {top > 0 && (
                      <label className="text-sm inline-flex items-center gap-1">
                        Ascension
                        <select className="rounded border-bw-1 border-ink bg-surface px-1 py-1" value={asc} onChange={(e) => setAscension({ ...ascension, [s.id]: Number(e.target.value) })}>
                          {Array.from({ length: top + 1 }, (_, i) => (
                            <option key={i} value={i}>
                              {i}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button type="button" className={primaryButton} disabled={!!starting || arcade.busy} onClick={() => void begin(s.id, { mode: 'normal', scenario: s.id, ascension: asc })}>
                      <Play size={14} aria-hidden="true" /> {starting === s.id ? 'Starting…' : 'Play'}
                    </button>
                    {asc > 0 && <p className="w-full text-xs text-muted">{ASCENSIONS.slice(0, asc).map((a) => a.text).join(' ')}</p>}
                  </div>
                ) : (
                  <p className="mt-3 text-sm font-semibold">{open.reason}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <HowItWorks />
      {apiEnabled && <Leaderboards scenarios={content.scenarios.map((s) => ({ id: s.id, title: s.title }))} day={arcade.daily.day} />}

      {shopOpen && <Shop items={shop(content, meta)} blueprints={meta.blueprints} equipped={meta.equipped} owned={meta.perks} onBuy={arcade.buy} onEquip={arcade.equip} onClose={() => setShopOpen(false)} />}
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="rounded-brutal border-bw-1 border-ink bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-semibold">How it works</summary>
      <ul className="mt-2 list-disc pl-5 space-y-1">
        <li>Twelve waves in three acts. Each wave, read the forecast, plan the board, and deploy: eight ticks of real simulated traffic follow.</li>
        <li>Cash pays the cloud bill; requests that succeed earn it. Trust is your lives: missed latency or availability targets, dropped requests and outages cost it.</li>
        <li>The score is revenue × quality × your uptime streak. Running every node between 40% and 75% at the peak earns the right-sized bonus; over-provisioning burns cash.</li>
        <li>Between waves, take a tech card. Every few waves, a contract adds a use case. Waves 4, 8 and 12 are bosses.</li>
        <li>Runs earn Blueprints for the shop: new components, rare cards and perks, which you keep. Clear a scenario to open the next difficulty.</li>
      </ul>
    </details>
  );
}

/** The shop's tabs: what each sells, for the tab's tooltip and the line under the tabs. */
const SHOP_TABS: { kind: ShopItem['kind']; label: string; icon: LucideIcon; blurb: string }[] = [
  { kind: 'component', label: 'Components', icon: Boxes, blurb: 'New building blocks for your board: caches, queues, CDNs and more. Each solves a problem the starting three cannot.' },
  { kind: 'feature', label: 'Features', icon: Wrench, blurb: 'New ways to build: bigger instances, sharded databases and longer lanes.' },
  { kind: 'card', label: 'Rare cards', icon: Sparkles, blurb: 'Powerful tech cards added to the draft pool between waves. Common and uncommon cards are in from the start.' },
  { kind: 'perk', label: 'Perks', icon: Medal, blurb: 'Permanent bonuses for every run, such as more seed money or a free reroll. Buy them, then equip them.' },
];

/** A shop item's tile: the board's icon for a component or feature, the content icon for a card or perk. */
function ShopTile({ item }: { item: ShopItem }) {
  if (item.kind === 'component' && item.role) return <IconTile icon={ICON[item.role]} tone={COMPONENT_TILE} size="lg" />;
  if (item.kind === 'feature' && item.id in FEATURE_ICON) return <IconTile icon={FEATURE_ICON[item.id as keyof typeof FEATURE_ICON]} tone={FEATURE_TILE} size="lg" />;
  if (item.icon) return <IconTile name={item.icon} tone={item.rarity ? RARITY_TILE[item.rarity] : PERK_TILE} size="lg" />;
  return null;
}

function Shop(props: { items: ShopItem[]; blueprints: number; equipped: string[]; owned: Record<string, number>; onBuy: (id: string) => Promise<void>; onEquip: (perks: string[]) => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState<ShopItem['kind']>('component');
  const slots = ascensionRules(0).perkSlots;
  const current = SHOP_TABS.find((t) => t.kind === tab) ?? SHOP_TABS[0];
  const items = props.items.filter((i) => i.kind === tab);
  return (
    <Modal title="Shop" onClose={props.onClose} wide>
      <p className="text-sm">
        <Gem size={14} aria-hidden="true" className="inline text-pop-blue" /> <strong>{props.blueprints}</strong> Blueprints. Runs earn them: one per wave survived, three per boss, more for a high score and a first clear.
      </p>
      <div className="ps-tabs mt-3" role="tablist">
        {SHOP_TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" id={`shop-tab-${t.kind}`} aria-controls="shop-panel" className="ps-tab inline-flex items-center gap-1.5" aria-selected={tab === t.kind} title={t.blurb} onClick={() => setTab(t.kind)}>
            <t.icon size={14} aria-hidden="true" className="hidden sm:inline" />
            {t.label}
          </button>
        ))}
      </div>
      <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${tab}`}>
        <p className="mt-2 text-sm text-muted">
          {current.blurb}
          {tab === 'perk' && <> Equip up to {slots}; from ascension 6, one fewer slot.</>}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((i) => {
            const equipped = props.equipped.includes(i.id);
            return (
              <li key={i.id} className="rounded border-bw-1 border-ink bg-surface p-2 flex items-start justify-between gap-2">
                <ShopTile item={i} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">
                    {i.name}
                    {i.maxLevel && i.maxLevel > 1 ? <span className="ml-1 text-xs text-muted">level {i.level}/{i.maxLevel}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{i.text}</p>
                  {i.blocked && <p className="mt-0.5 text-xs font-semibold">{i.blocked}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {i.kind === 'perk' && (props.owned[i.id] ?? 0) > 0 && (
                    <button
                      type="button"
                      className={equipped ? primaryButton : outlineButton}
                      aria-pressed={equipped}
                      disabled={!equipped && props.equipped.length >= slots}
                      onClick={() => void props.onEquip(equipped ? props.equipped.filter((p) => p !== i.id) : [...props.equipped, i.id])}
                    >
                      {equipped ? 'Equipped' : 'Equip'}
                    </button>
                  )}
                  {!i.owned ? (
                    <button type="button" className={outlineButton} disabled={!!i.blocked || props.blueprints < i.cost} onClick={() => void props.onBuy(i.id)}>
                      {i.cost} <Gem size={12} aria-hidden="true" />
                    </button>
                  ) : (
                    i.kind !== 'perk' && <span className="text-xs font-semibold text-pass">Owned</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

interface Board {
  board: string;
  title: string;
  players: number;
  entries: { rank: number; id: string; displayName: string; score: number; waves: number }[];
  you?: { score: number; rank: number | null; players: number } | null;
}

function Leaderboards({ scenarios, day }: { scenarios: { id: string; title: string }[]; day: string }) {
  const options = useMemo(() => [{ key: `day=${day}`, label: 'Daily run' }, ...scenarios.map((s) => ({ key: `scenario=${s.id}&ascension=0`, label: s.title }))], [scenarios, day]);
  const [which, setWhich] = useState(options[0].key);
  const [board, setBoard] = useState<Board | null>();
  useEffect(() => {
    let cancelled = false;
    setBoard(undefined);
    api<Board>(`/api/game/leaderboard?${which}`)
      .then((b) => !cancelled && setBoard(b))
      .catch(() => !cancelled && setBoard(null));
    return () => {
      cancelled = true;
    };
  }, [which]);
  return (
    <section className="rounded-brutal border-bw-2 border-ink bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-extrabold flex items-center gap-1.5">
          <Trophy size={18} aria-hidden="true" /> Leaderboard
        </h3>
        <select className="rounded border-bw-1 border-ink bg-surface px-2 py-1 text-sm" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Leaderboard">
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {board === undefined && <p className="mt-2 text-sm text-muted">Loading…</p>}
      {board === null && <p className="mt-2 text-sm text-muted">The leaderboard is not available right now.</p>}
      {board && (
        <>
          <p className="mt-1 text-xs text-muted">
            {board.title} · {board.players} player{board.players === 1 ? '' : 's'}
          </p>
          {board.entries.length === 0 ? (
            <p className="mt-2 text-sm">No one on it yet. Be the first.</p>
          ) : (
            <ol className="mt-2 divide-y divide-ink/10">
              {board.entries.map((e) => (
                <li key={`${e.rank}-${e.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="inline-block w-7 font-mono text-muted">#{e.rank}</span>
                    <a className="font-semibold hover:underline" href={`#/u/${e.id}`}>
                      {e.displayName}
                    </a>
                  </span>
                  <span className="font-mono font-bold sf-count">
                    {e.score.toLocaleString('en-US')}
                    <span className="ml-1 text-xs font-normal text-muted">w{e.waves}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {board.you && (
            <p className="mt-2 text-sm">
              You: <strong>{board.you.score.toLocaleString('en-US')}</strong>
              {board.you.rank ? `, #${board.you.rank} of ${board.you.players}` : ''}
            </p>
          )}
        </>
      )}
    </section>
  );
}
