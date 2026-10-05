import { CheckCircle2, GitBranch, Search, Undo2, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import Markdown from '../../practice/Markdown';
import { eyebrow, outlineButton } from '../../components/Playground/ui';
import type { Forecast, Game } from '../engine/run';
import { MIGRATION_PHASES, type DiagnosisDef, type MigrationPhase } from '../engine/types';
import { IconTile } from './gameIcons';
import { rps, SENDER_LABEL, TICKET_ICON, usd } from './visual';

/**
 * The design-first modes' panels: the wave's ticket (who asks for what), and
 * the changes in flight: migrations one phase a wave, and old API versions
 * still served.
 */

const panel = 'rounded-brutal border-bw-1 border-ink bg-surface shadow-brutal-sm';

/** The ticket of the wave, as it would land in an inbox. */
export function TicketCard({ ticket }: { ticket: NonNullable<Forecast['ticket']> }) {
  return (
    <article className={`${panel} p-3`} aria-label={`Ticket: ${ticket.title}`}>
      <div className="flex items-start gap-2.5">
        <IconTile name={TICKET_ICON[ticket.kind]} tone="bg-pop-yellow text-on-accent" />
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>
            {SENDER_LABEL[ticket.from]} · {ticket.kind.replace('-', ' ')}
          </p>
          <h3 className="font-display text-lg font-extrabold leading-tight">{ticket.title}</h3>
        </div>
      </div>
      {ticket.text && (
        <div className="mt-2 text-sm">
          <Markdown source={ticket.text} />
        </div>
      )}
    </article>
  );
}

const PHASE_LABEL: Record<MigrationPhase, string> = {
  none: 'Not started',
  expand: 'Expand',
  'dual-write': 'Dual write',
  backfill: 'Backfill',
  cutover: 'Cut over',
  contract: 'Contract',
};

const PHASE_HELP: Record<MigrationPhase, string> = {
  none: 'Nothing has changed yet.',
  expand: 'Add the new shape next to the old one. Nothing reads it yet.',
  'dual-write': 'Writers write both shapes: twice the writes on the store.',
  backfill: 'A background job rewrites the old rows, in batches, on the store.',
  cutover: 'Reads use the new shape: what needs it can be served.',
  contract: 'The old shape is dropped. Anything still reading it breaks.',
};

/** Migrations and legacy versions, with what can be done about them this wave. */
export function ChangesPanel({ game, planning, onMigrate, onSunset }: { game: Game; planning: boolean; onMigrate: (id: string, to: 'next' | 'rollback' | 'big-bang') => void; onSunset: (key: string) => void }) {
  const s = game.state;
  const migrations = game.scenario.migrations;
  const peak = new Map(game.forecast().peak.map((p) => [p.key, p.rps]));
  const versions = s.useCases.filter((k) => {
    const legacy = game.scenario.useCases[k]?.legacy;
    return legacy && s.useCases.includes(legacy.replacedBy);
  });
  if (!migrations.length && !versions.length) return null;
  return (
    <section className={`${panel} space-y-3 p-3`} aria-label="Changes in flight">
      {migrations.map((m) => {
        const st = game.migrationOf(m.id);
        const at = MIGRATION_PHASES.indexOf(st.phase);
        const stepped = st.wave === s.wave;
        const next = MIGRATION_PHASES[at + 1];
        const done = st.phase === 'contract';
        return (
          <div key={m.id}>
            <p className={eyebrow}>Migration: {m.entity}</p>
            <ol className="mt-1 flex flex-wrap gap-1" aria-label={`${m.name}: ${PHASE_LABEL[st.phase]}`}>
              {MIGRATION_PHASES.slice(1).map((p, i) => (
                <li
                  key={p}
                  aria-current={p === st.phase ? 'step' : undefined}
                  className={`rounded border-bw-1 px-1.5 py-0.5 text-xs font-semibold ${i + 1 <= at ? 'border-ink bg-pop-yellow text-on-accent' : 'border-ink/30 text-muted'}`}
                >
                  {PHASE_LABEL[p]}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-sm text-muted">
              {PHASE_HELP[st.phase]}
              {st.phase === 'backfill' && ` (${rps(m.backfillRps)} writes a second, this wave)`}
              {stepped && ' One step a wave: this one is planned.'}
            </p>
            {planning && !done && (
              <div className="mt-2 flex flex-wrap gap-2">
                {next && (
                  <button type="button" className={outlineButton} disabled={stepped} onClick={() => onMigrate(m.id, 'next')}>
                    Next: {PHASE_LABEL[next]}
                  </button>
                )}
                {at > 0 && (
                  <button type="button" className={outlineButton} disabled={stepped} onClick={() => onMigrate(m.id, 'rollback')}>
                    <Undo2 size={14} aria-hidden="true" /> Roll back
                  </button>
                )}
                {at < MIGRATION_PHASES.indexOf('cutover') && (
                  <button
                    type="button"
                    className={`${outlineButton} text-fail`}
                    disabled={stepped}
                    onClick={() => {
                      if (window.confirm(`Do ${m.name} in one go? It rewrites every ${m.entity} row while holding the table's write lock, and drops the old shape at once.`)) onMigrate(m.id, 'big-bang');
                    }}
                  >
                    <Zap size={14} aria-hidden="true" /> All at once
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {versions.length > 0 && (
        <div>
          <p className={eyebrow}>Old API versions</p>
          <ul className="mt-1 space-y-1.5">
            {versions.map((k) => {
              const uc = game.scenario.useCases[k];
              const sunset = s.sunset.includes(k);
              const left = peak.get(k) ?? 0;
              return (
                <li key={k} className="flex flex-wrap items-center gap-2 text-sm">
                  <GitBranch size={14} aria-hidden="true" />
                  <span className="flex-1">
                    <strong>{uc.name}</strong>{' '}
                    {sunset ? <span className="text-muted">sunset</span> : <span className="text-muted">{rps(left)} rps at the peak · {usd(uc.legacy!.upkeep)} a wave to keep</span>}
                  </span>
                  {planning && !sunset && (
                    <button
                      type="button"
                      className={outlineButton}
                      onClick={() => {
                        if (left === 0 || window.confirm(`${rps(left)} rps still call "${uc.name}". Sunset it anyway? Those clients get 410 Gone.`)) onSunset(k);
                      }}
                    >
                      Sunset
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** On-call: name the root cause before touching anything; the answer explains every option. */
export function DiagnosisPanel({ diagnosis, picked, onPick }: { diagnosis: DiagnosisDef; picked?: { pick: string; correct: boolean }; onPick: (id: string) => void }) {
  const [choice, setChoice] = useState<string>();
  return (
    <section className={`${panel} p-3`} aria-label="Diagnosis">
      <p className={`${eyebrow} flex items-center gap-1.5`}>
        <Search size={14} aria-hidden="true" /> Diagnose before you act
      </p>
      <fieldset className="mt-1">
        <legend className="font-semibold">{diagnosis.question}</legend>
        <ul className="mt-2 space-y-1.5">
          {diagnosis.options.map((o) => {
            const mine = picked?.pick === o.id;
            return (
              <li key={o.id}>
                <label className={`flex items-start gap-2 rounded border-bw-1 p-2 text-sm ${picked ? (o.correct ? 'border-pass bg-pass/10' : mine ? 'border-fail bg-fail/10' : 'border-ink/20') : 'border-ink/30 hover:bg-ink/5'}`}>
                  <input type="radio" name="diagnosis" className="mt-0.5" disabled={!!picked} checked={picked ? mine : choice === o.id} onChange={() => setChoice(o.id)} />
                  <span>
                    {o.text}
                    {picked && (
                      <span className="mt-0.5 flex items-start gap-1 text-muted">
                        {o.correct ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-pass" aria-label="Right" /> : <XCircle size={14} className="mt-0.5 flex-shrink-0 text-fail" aria-label="Wrong" />}
                        {o.why}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {!picked && (
        <button type="button" className={`${outlineButton} mt-2`} disabled={!choice} onClick={() => choice && onPick(choice)}>
          Commit to this cause
        </button>
      )}
      {picked && <p className={`mt-2 text-sm font-semibold ${picked.correct ? 'text-pass' : 'text-fail'}`}>{picked.correct ? 'Right: now fix it on the board.' : 'Not it: that cost Trust. Fix the real cause on the board.'}</p>}
    </section>
  );
}
