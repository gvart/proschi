import { useEffect, useRef } from 'react';
import { ArrowLeft, Coins, ExternalLink, Gem, Heart, Infinity as InfinityIcon, RotateCcw, Trophy } from 'lucide-react';
import { celebrate } from '../../design/celebrate';
import { encodeShareHash } from '../../playground/share';
import { eyebrow, outlineButton, primaryButton } from '../../components/Playground/ui';
import type { Game } from '../engine/run';
import type { GameContent } from '../engine/types';
import { exportSource } from './exportSource';
import { BreachCard, LearnLinks, Stat, Timeline } from './Panels';
import { topMistakes, usd } from './visual';
import { MutatorLearn } from './Twists';
import type { RunResult } from './useArcade';

/**
 * The end of a run: the score, what it earned, the timeline of every wave,
 * the three most costly mistakes with their fixes, the design in interview
 * words, and the final design in the editor. After the last scripted wave,
 * the choice to bank the score or keep going.
 */

const OUTCOME: Record<string, string> = {
  retired: 'Cleared! You scaled it.',
  max: 'Endless survived. Legendary.',
  churned: 'Your users churned.',
  bankrupt: 'Out of runway.',
};

export default function Report(props: {
  game: Game;
  content: GameContent;
  result?: RunResult;
  signedIn: boolean;
  onEndless: () => void;
  onRetire: () => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { game, content, result } = props;
  const s = game.state;
  const headline = useRef<HTMLHeadingElement>(null);
  const cleared = s.phase === 'cleared';
  useEffect(() => {
    if ((cleared || s.cleared) && headline.current) void celebrate(headline.current, { count: 24 });
  }, [cleared, s.cleared]);

  const editorHref = (() => {
    try {
      return `../app/${encodeShareHash(exportSource(game, content))}`;
    } catch {
      return undefined;
    }
  })();
  const mistakes = topMistakes(s.history);
  const claimed = s.history.flatMap((h) => (h.bounty ? [h.bounty] : []));
  const bounties = { total: claimed.length, met: claimed.filter((b) => b.met).length, cash: claimed.reduce((t, b) => t + b.cash, 0), points: claimed.reduce((t, b) => t + b.points, 0) };
  const events = new Map(content.events.map((e) => [e.id, e]));
  const related = game.scenario.related;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <button type="button" className={outlineButton} onClick={props.onExit}>
        <ArrowLeft size={14} aria-hidden="true" /> Arcade
      </button>
      <header className="rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
        <p className={eyebrow}>
          {game.scenario.title}
          {game.setup.ascension ? ` · ascension ${game.setup.ascension}` : ''}
          {game.setup.mode === 'daily' ? ' · daily run' : ''}
        </p>
        <h1 ref={headline} className="mt-1 font-display text-3xl sm:text-4xl font-extrabold sf-stamp">
          {cleared ? 'All 12 waves cleared!' : (OUTCOME[s.outcome ?? ''] ?? 'Run over')}
        </h1>
        {cleared && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primaryButton} onClick={props.onRetire}>
              <Trophy size={14} aria-hidden="true" /> Bank the score
            </button>
            <button type="button" className={outlineButton} onClick={props.onEndless}>
              <InfinityIcon size={14} aria-hidden="true" /> Keep going: Endless
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<Trophy size={11} aria-hidden="true" />} label="Score" value={s.score.toLocaleString('en-US')} />
        <Stat icon={<Heart size={11} aria-hidden="true" />} label="Waves" value={`${s.history.filter((h) => h.survived).length}`} />
        <Stat icon={<Coins size={11} aria-hidden="true" />} label="Cash" value={`$${Math.round(s.cash).toLocaleString('en-US')}`} />
        <Stat icon={<Gem size={11} aria-hidden="true" />} label="Blueprints" value={result ? `+${result.blueprints}` : cleared ? '…' : '…'} />
      </div>
      {result?.rank != null && (
        <p className="text-sm">
          Rank <strong>#{result.rank}</strong> of {result.players} on this leaderboard.
        </p>
      )}
      {result?.firstClear && <p className="text-sm text-pass">First clear of {game.scenario.title}: +5 Blueprints.</p>}
      {result?.error && <p className="text-sm text-fail">{result.error}</p>}
      {!props.signedIn && s.phase === 'over' && <p className="text-sm text-muted">Signed out, progress stays in this browser; sign in to rank on the leaderboards and keep it everywhere.</p>}

      <section className="rounded-brutal border-bw-1 border-ink bg-surface p-3">
        <p className={eyebrow}>Revenue and cost per wave</p>
        <Timeline history={s.history} events={events} />
      </section>

      {(game.mutatorDef || bounties.total > 0) && (
        <section className="rounded-brutal border-bw-1 border-ink bg-surface p-3 text-sm">
          {bounties.total > 0 && (
            <p>
              <strong>Bounties:</strong> {bounties.met} of {bounties.total} claimed, for {usd(bounties.cash)} and {bounties.points.toLocaleString('en-US')} points.
            </p>
          )}
          {game.mutatorDef && <MutatorLearn mutator={game.mutatorDef} />}
        </section>
      )}

      {mistakes.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display font-extrabold text-xl">What cost you the most</h3>
          {mistakes.map((m) => (
            <div key={`${m.breach.kind}:${m.breach.node ?? m.breach.useCase}`}>
              <p className="text-xs text-muted">
                −{m.trust} Trust, wave{m.waves.length > 1 ? 's' : ''} {m.waves.join(', ')}
              </p>
              <BreachCard breach={m.breach} during={[...new Set(m.waves.flatMap((w) => s.history[w - 1]?.events.map((e) => e.id) ?? []))].map((id) => events.get(id)).filter((d) => d !== undefined)} />
            </div>
          ))}
        </section>
      )}

      <section className="rounded-brutal border-bw-1 border-ink bg-pop-lilac/20 p-3">
        <h3 className="font-display font-extrabold text-xl">How you would say it in an interview</h3>
        <p className="mt-2 text-sm">{game.scenario.sections['Interview translation']}</p>
        <LearnLinks ids={game.scenario.cards} max={4} />
      </section>

      <div className="flex flex-wrap gap-2">
        {s.phase === 'over' && (
          <button type="button" className={primaryButton} onClick={props.onAgain}>
            <RotateCcw size={14} aria-hidden="true" /> Play again
          </button>
        )}
        {editorHref && (
          <a className={outlineButton} href={editorHref} target="_blank" rel="noopener">
            <ExternalLink size={14} aria-hidden="true" /> Open your design in the editor
          </a>
        )}
        {related.map((id) => (
          <a key={id} className={outlineButton} href={`#/${id}`}>
            Try the {id.replace(/-/g, ' ')} problem
          </a>
        ))}
      </div>
    </div>
  );
}
