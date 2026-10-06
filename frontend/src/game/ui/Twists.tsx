import { Shuffle } from 'lucide-react';
import { eyebrow, outlineButton } from '../../components/Playground/ui';
import type { Forecast, WaveSummary } from '../engine/run';
import type { BountyDef, MutatorDef } from '../engine/types';
import { IconTile } from './gameIcons';
import { LearnLinks, Modal } from './Panels';
import { BOUNTY_TILE, MUTATOR_TILE, usd } from './visual';

const times = (n: number) => `×${Number(n.toFixed(2))}`;

/**
 * The start of a Scale or Fail run: three mutators, each a twist on the
 * whole run that pays more points. The daily run offers everyone the same
 * three.
 */
export function MutatorPicker({ offer, daily, onPick }: { offer: MutatorDef[]; daily: boolean; onPick: (i: number | null) => void }) {
  return (
    <Modal title="Pick this run's mutator" wide>
      <p className="text-sm text-muted">
        A twist on the whole run: it changes what the winning design looks like, and every point you score is worth more. {daily && 'Everyone playing today gets the same three.'}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {offer.map((m, i) => (
          <li key={m.id} className="sf-card">
            <button type="button" onClick={() => onPick(i)} className="h-full w-full text-left rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm transition-transform duration-d1 hover:-translate-y-1 hover:shadow-brutal-md">
              <span className="flex items-start gap-2">
                <IconTile name={m.icon} tone={MUTATOR_TILE} size="lg" className="shadow-brutal-sm" />
                <span className="min-w-0">
                  <span className={`${eyebrow} block`}>Score {times(m.score)}</span>
                  <span className="mt-0.5 block font-display font-extrabold text-lg leading-tight">{m.name}</span>
                </span>
              </span>
              <p className="mt-1 text-sm">{m.text}</p>
              <p className="mt-2 text-xs text-muted">{m.why}</p>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button type="button" className={outlineButton} onClick={() => onPick(null)}>
          <Shuffle size={14} aria-hidden="true" /> Play it straight (×1)
        </button>
      </div>
    </Modal>
  );
}

/** The run's mutator, as a chip: what it is and what it pays. */
export function MutatorChip({ mutator }: { mutator: MutatorDef }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border-bw-1 border-ink/40 bg-pop-pink/15 px-1.5 py-0.5 text-xs font-semibold" title={mutator.text}>
      <IconTile name={mutator.icon} tone={MUTATOR_TILE} size="sm" />
      {mutator.name} <span className="font-mono">{times(mutator.score)}</span>
    </span>
  );
}

/** This wave's bounty in the forecast: the objective and its pay. */
export function BountyLine({ bounty }: { bounty: NonNullable<Forecast['bounty']> }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded border-bw-1 border-dashed border-ink/50 bg-pop-yellow/10 p-1.5 text-sm" aria-label="Bounty">
      <IconTile name={bounty.icon} tone={BOUNTY_TILE} size="sm" />
      <span>
        <strong>Bounty: {bounty.name}.</strong> {bounty.text}{' '}
        <span className="text-muted">
          Pays {usd(bounty.pays.cash)} and {bounty.pays.points.toLocaleString('en-US')} points.
        </span>
      </span>
    </p>
  );
}

/** The wave's bounties on offer: take one before deploying (a missed one costs part of its cash), or none. */
export function BountyChoice({ offer, onPick }: { offer: Forecast['bountyOffer']; onPick: (i: number) => void }) {
  return (
    <div className="mt-2 rounded border-bw-1 border-dashed border-ink/50 bg-pop-yellow/10 p-1.5 text-sm" role="group" aria-label="Bounties">
      <p className="font-semibold">Take a bounty, or none. Met, it pays; missed, it costs a quarter of its cash.</p>
      <ul className="mt-1 grid gap-1.5 sm:grid-cols-3">
        {offer.map((b, i) => (
          <li key={b.id}>
            <button type="button" className="flex h-full w-full items-start gap-1.5 rounded border-bw-1 border-ink/40 bg-surface p-1.5 text-left hover:border-ink" onClick={() => onPick(i)} aria-label={`Take the bounty ${b.name}`}>
              <IconTile name={b.icon} tone={BOUNTY_TILE} size="sm" />
              <span>
                <strong>{b.name}.</strong> {b.text}{' '}
                <span className="text-muted">
                  {usd(b.pays.cash)}, {b.pays.points.toLocaleString('en-US')} pts
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The bounty's outcome in the wave's debrief. */
export function BountyResult({ result, def }: { result: NonNullable<WaveSummary['bounty']>; def?: BountyDef }) {
  return (
    <div className={`flex items-start gap-1.5 rounded border-bw-1 p-2 ${result.met ? 'border-pass bg-pass/10' : 'border-ink/40 bg-surface'}`}>
      {def && <IconTile name={def.icon} tone={BOUNTY_TILE} size="sm" />}
      <div>
        <p className="font-semibold">
          Bounty {result.met ? 'claimed' : 'missed'}: {def?.name ?? result.id}
          {result.met ? (
            <span className="ml-1 font-mono text-pass">
              +{usd(result.cash)}, +{result.points.toLocaleString('en-US')} pts
            </span>
          ) : result.cash < 0 ? (
            <span className="ml-1 font-mono text-fail">{usd(result.cash)}</span>
          ) : null}
        </p>
        {def && <p className="text-xs text-muted">{def.text}</p>}
      </div>
    </div>
  );
}

/** A mutator's review cards, for the end-of-run report. */
export function MutatorLearn({ mutator }: { mutator: MutatorDef }) {
  return (
    <div className="mt-2 text-sm">
      <MutatorChip mutator={mutator} />
      <p className="mt-1">{mutator.why}</p>
      <LearnLinks ids={mutator.learn} max={2} />
    </div>
  );
}
