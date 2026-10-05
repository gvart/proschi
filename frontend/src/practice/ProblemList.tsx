import { useMemo, useState, type ReactNode } from 'react';
import { CompanyBadge, DifficultyBadge, StatusIcon } from './Badges';
import ContributeCard from './ContributeCard';
import { PrepBanner } from './prep/PrepHub';
import type { ProblemListing } from './listing';
import { statusOf, type Progress } from './progress';
import ProblemFilters from './ProblemFilters';
import { NO_FILTERS, STATUS_LABEL, type Filters } from './listFilters';
import type { StatsSummary } from '../services/api';

interface ProblemListProps {
  problems: ProblemListing[];
  progress: Progress;
  /** Global solve rates, when the API is there. */
  stats?: StatsSummary;
  /** After the list, e.g. the leaderboard. */
  children?: ReactNode;
}

/** Every problem with its difficulty, tags and status, filtered by those and by a search. */
export default function ProblemList({ problems, progress, stats, children }: ProblemListProps) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const { difficulty, tag, company, status } = filters;
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

      <PrepBanner />

      <ProblemFilters query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} tags={tags} companies={companies} />

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
