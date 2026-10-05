import type { ReactNode } from 'react';
import { Flame, Snowflake } from 'lucide-react';
import deck from 'virtual:practice-cards';
import { percent } from '../../learn/mastery';
import { eyebrow } from '../../components/Playground/ui';
import { DifficultyBadge } from '../Badges';
import { DIFFICULTIES } from '../types';
import SkillRadar, { type RadarPoint } from '../skills/SkillRadar';
import BadgeGrid from './BadgeGrid';
import { solvedByDifficulty, type ProfileModel } from './profile';

/**
 * A profile's layout, the same for the account page (`#/me`) and a public
 * profile (`#/u/<id>`): the name and when they joined, the streak, the
 * totals and the interview-ready score, the skill map, every badge as a
 * compact grid and the problems solved. What only the learner sees (the
 * freezes, card counts, the daily goal and the visibility setting) shows when
 * the model or the slots have it.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';

/** "May 2026", in the reader's language. */
const monthOf = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

const days = (n: number) => (n === 1 ? 'day' : 'days');

interface ProfileViewProps {
  model: ProfileModel;
  /** The small line over the name, e.g. "Your profile". */
  kicker: string;
  /** Under the name, e.g. the public profile note or the sign-in invitation. */
  note?: ReactNode;
  /** Under the totals, e.g. the daily goal picker. */
  goal?: ReactNode;
  /** At the end, e.g. the public profile setting. */
  children?: ReactNode;
}

export default function ProfileView({ model, kicker, note, goal, children }: ProfileViewProps) {
  const byDifficulty = solvedByDifficulty(model.solved);
  const mastery = new Map(model.topics.map((t) => [t.topic, t.mastery]));
  // Every topic with cards, in tags.json's order.
  const points: RadarPoint[] = deck.topics
    .filter((t) => deck.cards.some((c) => !c.retired && c.tags.includes(t.id)))
    .map((t) => ({ id: t.id, label: t.title, value: mastery.get(t.id) ?? 0 }));
  const readiness = percent(model.readiness);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <p className={eyebrow}>{kicker}</p>
      <h1 className="mt-1 break-words font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">{model.displayName}</h1>
      {model.memberSince !== undefined && <p className="mt-2 text-sm text-muted">Member since {monthOf(model.memberSince)}</p>}
      {note}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
        {model.streak && (
          <Stat
            label="Current streak"
            value={model.streak.current}
            unit={days(model.streak.current)}
            icon={<Flame size={16} aria-hidden="true" className={model.streak.current > 0 ? 'fill-pop-yellow text-ink' : 'text-muted'} />}
          />
        )}
        {model.streak && <Stat label="Longest streak" value={model.streak.longest} unit={days(model.streak.longest)} />}
        {model.streak?.freezes !== undefined && (
          <Stat label="Streak freezes" value={model.streak.freezes} icon={<Snowflake size={16} aria-hidden="true" className="text-ink" />} />
        )}
        <Stat label="Interview ready" value={readiness} unit="%" testId="profile-readiness" />
        <Stat label="Problems solved" value={model.solved.length} detail={DIFFICULTIES.map((d) => `${byDifficulty[d]} ${d}`).join(' · ')} />
        {model.cards && <Stat label="Cards reviewed" value={model.cards.reviewed} />}
        {model.cards && <Stat label="Cards mastered" value={model.cards.mastered} />}
      </dl>
      {goal && <div className="mt-4">{goal}</div>}

      <section aria-labelledby="profile-skill-map" className={`mt-6 p-4 sm:p-5 ${card}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="profile-skill-map" className={eyebrow}>
            Skill map
          </h2>
          <p className="text-sm text-ink/80">
            <span className="font-display text-xl font-extrabold tabular-nums text-ink">{readiness}%</span> interview ready
          </p>
        </div>
        <SkillRadar points={points} summary={`Topic mastery, from 0 to 100%. Interview ready: ${readiness}%. Each topic's value is in the table that follows.`} />
        <table className="sr-only">
          <caption>Mastery per topic</caption>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Mastery</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.label}</th>
                <td>{percent(p.value)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-8">
        <BadgeGrid badges={model.badges} />
      </div>

      <section aria-labelledby="profile-solved" className="mt-8">
        <h2 id="profile-solved" className="font-display text-xl font-bold text-ink">
          Problems solved
        </h2>
        {model.solved.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/15 overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-sm shadow-brutal-sm">
            {model.solved.map((p) => (
              <li key={p.id}>
                <a href={`#/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-none focus-visible:bg-pop-yellow/25">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.title}</span>
                  <DifficultyBadge difficulty={p.difficulty} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {children}
    </main>
  );
}

/** One total: a label, a number with its unit, an icon after it and a detail line under it. */
function Stat({ label, value, unit, icon, detail, testId }: { label: string; value: number; unit?: string; icon?: ReactNode; detail?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded-brutal border-bw-2 border-ink bg-surface px-3 py-2 shadow-brutal-sm">
      <dt className={eyebrow}>{label}</dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums text-ink">
        <span className="inline-flex items-center gap-1.5" data-testid={testId}>
          {value}
          {unit && <span className="text-sm font-semibold text-muted">{unit}</span>}
          {icon}
        </span>
        {detail && <span className="block font-sans text-xs font-semibold text-muted">{detail}</span>}
      </dd>
    </div>
  );
}
