import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { CompanyBadge, DifficultyBadge, StatusIcon } from './Badges';
import { field } from '../components/Playground/ui';
import RoadmapCard from './RoadmapCard';
import ReviewCard from './ReviewCard';
import ContributeCard from './ContributeCard';
import { DIFFICULTIES, type Problem } from './types';
import type { ProblemListing } from './listing';
import { statusOf, type Progress, type Status } from './progress';
import type { StatsSummary } from '../services/api';

interface ProblemListProps {
  problems: ProblemListing[];
  progress: Progress;
  /** Global solve rates, when the API is there. */
  stats?: StatsSummary;
  /** In the daily review card: the streak, or the invitation to sign in for one. */
  streak?: ReactNode;
  /** Under the roadmap's and review's cards, e.g. the progress strip. */
  summary?: ReactNode;
  /** After the list, e.g. the leaderboard. */
  children?: ReactNode;
}

const STATUS_LABEL: Record<Status, string> = { todo: 'To do', attempted: 'Attempted', solved: 'Solved' };

/** Every problem with its difficulty, tags and status, filtered by those and by a search. */
export default function ProblemList({ problems, progress, stats, streak, summary, children }: ProblemListProps) {
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Problem['difficulty']>('');
  const [tag, setTag] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const tags = useMemo(() => [...new Set(problems.flatMap((p) => p.tags))].sort(), [problems]);
  // Only companies some problem names (problem.md `company`).
  const companies = useMemo(() => [...new Set(problems.flatMap((p) => (p.company ? [p.company] : [])))].sort((a, b) => a.localeCompare(b, 'en')), [problems]);

  const shown = problems.filter(
    (p) =>
      (!difficulty || p.difficulty === difficulty) &&
      (!tag || p.tags.includes(tag)) &&
      (!company || p.company === company) &&
      (!status || statusOf(progress, p.id) === status) &&
      (!query || `${p.title} ${p.tags.join(' ')} ${p.company ?? ''}`.toLowerCase().includes(query.toLowerCase())),
  );
  const solved = problems.filter((p) => statusOf(progress, p.id) === 'solved').length;
  const select = field;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">System design practice</h1>
      <p className="mt-3 max-w-2xl text-base text-ink/80">
        Each problem gives use cases, traffic and requirements. Design the system in Proschi; the tests run in your browser and explain what holds up and
        what does not.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="inline-flex rounded-full border-bw-1 border-ink bg-surface px-3 py-1 text-sm font-semibold tabular-nums text-ink">
          {solved} of {problems.length} solved
          {stats && stats.solvers > 0 && <> · {stats.solvers} {stats.solvers === 1 ? 'person has' : 'people have'} solved at least one</>}
        </p>
      </div>

      <RoadmapCard problems={problems} progress={progress} />
      <ReviewCard>{streak}</ReviewCard>
      {summary}

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">Search</span>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search problems"
            className={`w-full ${field} pl-8 placeholder:text-muted`}
          />
        </label>
        <select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Problem['difficulty'] | '')} className={select}>
          <option value="">All difficulties</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d[0].toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
        <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className={select}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {companies.length > 0 && (
          <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className={select} title="The company whose published system a problem is based on">
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} className={select}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-5 divide-y-2 divide-ink overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
        {shown.map((p) => {
          const s = statusOf(progress, p.id);
          return (
            <li key={p.id}>
              <a
                href={`#/${p.id}`}
                className="group flex items-center gap-3 px-4 py-3.5 transition-[background-color,box-shadow] duration-d1 hover:bg-pop-yellow/25 hover:shadow-[inset_6px_0_0_rgb(var(--c-ink))] focus-visible:outline-none focus-visible:bg-pop-yellow/25 focus-visible:shadow-[inset_6px_0_0_rgb(var(--c-blue))]"
              >
                <StatusIcon status={s} />
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-lg font-bold leading-tight text-ink">{p.title}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {p.company && <CompanyBadge company={p.company} />}
                    {p.tags.map((t) => (
                      <span key={t} className="rounded border border-ink/25 px-1.5 py-0.5 font-mono text-[11px] text-ink/75">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
                <SolveRate summary={stats?.problems[p.id]} />
                <span className="hidden sm:inline text-xs text-muted">{STATUS_LABEL[s]}</span>
                <DifficultyBadge difficulty={p.difficulty} />
              </a>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No problem matches these filters.</li>}
      </ul>
      <ContributeCard />
      {children}
    </main>
  );
}

/** "40% solved" over everyone who recorded a run; nothing until someone has. */
function SolveRate({ summary }: { summary?: StatsSummary['problems'][string] }) {
  if (!summary || summary.attempted === 0) return null;
  const runs = summary.medianRunsToSolve !== null ? `; a median of ${Math.round(summary.medianRunsToSolve * 10) / 10} test runs to solve` : '';
  return (
    <span className="hidden sm:inline text-xs tabular-nums text-muted" title={`Solved by ${summary.solved} of ${summary.attempted} who tried${runs}`}>
      {Math.round((summary.solved / summary.attempted) * 100)}% solved
    </span>
  );
}
