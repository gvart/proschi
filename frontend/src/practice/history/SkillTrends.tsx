import { useState } from 'react';
import { SKILL_LABEL, SKILLS, type Skill } from '../modes/ai/api';
import { formatDay, type HistorySession } from './api';

/**
 * The score per skill over the AI interviews, as small multiples: one panel
 * per skill (the five never share an axis, so they never tangle), each a
 * 2px line over the sessions in time order on the same 1 to 5 scale, drawn
 * in SVG with the theme's colours like the skill map. Hovering or focusing a
 * session marks it in every panel and names it, with each score, below; the
 * numbers are in a table for screen readers too.
 */

const W = 160;
const H = 72;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
const TICKS = [1, 3, 5];

const x = (i: number, n: number) => (n <= 1 ? W / 2 : PAD_X + ((W - 2 * PAD_X) * i) / (n - 1));
const y = (score: number) => PAD_TOP + ((5 - score) / 4) * (H - PAD_TOP - PAD_BOTTOM);

function Panel({ skill, sessions, active, onActive }: { skill: Skill; sessions: HistorySession[]; active?: number; onActive: (i: number | undefined) => void }) {
  const n = sessions.length;
  const points = sessions.map((s, i) => [x(i, n), y(s.scores[skill])] as const);
  const latest = sessions[n - 1].scores[skill];
  const first = sessions[0].scores[skill];
  const shown = active !== undefined ? sessions[active].scores[skill] : latest;
  // The hit target of each session: its column, wider than the dot.
  const band = n <= 1 ? W : (W - 2 * PAD_X) / (n - 1);
  return (
    <figure className="min-w-0 rounded-sm border-bw-1 border-ink/30 bg-paper px-3 pb-2 pt-2.5">
      <figcaption className="flex items-baseline justify-between gap-1.5">
        <span className="min-w-0 truncate text-xs font-semibold text-ink sm:text-[13px]">{SKILL_LABEL[skill]}</span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-ink" data-testid={`trend-${skill}`}>
          {shown}/5
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full overflow-visible" aria-hidden="true" onMouseLeave={() => onActive(undefined)}>
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgb(var(--c-ink) / 0.12)" strokeWidth={1} />
            <text x={0} y={y(t) - 2} fontSize={9} fill="rgb(var(--c-muted))">
              {t}
            </text>
          </g>
        ))}
        {active !== undefined && <line x1={points[active][0]} x2={points[active][0]} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM + 4} stroke="rgb(var(--c-ink) / 0.35)" strokeWidth={1} />}
        {n > 1 && <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="rgb(var(--c-blue))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map(([px, py], i) => (
          <g key={sessions[i].id}>
            <rect x={px - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => onActive(i)} />
            {(i === active || i === n - 1 || n <= 12) && (
              <circle cx={px} cy={py} r={i === active ? 5 : 4} fill="rgb(var(--c-blue))" stroke="rgb(var(--c-paper))" strokeWidth={2} pointerEvents="none" />
            )}
          </g>
        ))}
      </svg>
      <p className="text-[11px] tabular-nums text-muted">{n > 1 ? (latest > first ? `Up from ${first}` : latest < first ? `Down from ${first}` : `Steady at ${first}`) : 'One session so far'}</p>
    </figure>
  );
}

export default function SkillTrends({ sessions, problemTitle }: { sessions: HistorySession[]; problemTitle: (id: string) => string }) {
  /** Oldest first, left to right. */
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const [active, setActive] = useState<number>();
  if (!ordered.length) return null;
  const current = active !== undefined ? ordered[active] : undefined;
  return (
    <div data-testid="skill-trends">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {SKILLS.map((s) => (
          <Panel key={s} skill={s} sessions={ordered} active={active} onActive={setActive} />
        ))}
      </div>
      <p className="mt-2 min-h-[1.25rem] text-sm tabular-nums text-ink/80" aria-hidden="true">
        {current ? (
          <>
            <span className="font-semibold text-ink">
              {formatDay(current.startedAt)} · {problemTitle(current.problem)}
            </span>{' '}
            · {current.passed ? 'Pass' : 'Not yet a pass'}
          </>
        ) : (
          `Scores out of 5 across your last ${ordered.length} ${ordered.length === 1 ? 'interview' : 'interviews'}, oldest on the left. Hover to see a session.`
        )}
      </p>
      <table className="sr-only">
        <caption>Scores per skill, out of 5, oldest interview first</caption>
        <thead>
          <tr>
            <th scope="col">Interview</th>
            {SKILLS.map((s) => (
              <th key={s} scope="col">
                {SKILL_LABEL[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {formatDay(r.startedAt)}, {problemTitle(r.problem)}
              </th>
              {SKILLS.map((s) => (
                <td key={s}>{r.scores[s]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
