import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DifficultyBadge, StatusIcon } from './Badges';
import { DIFFICULTIES, type Problem } from './types';
import type { ProblemListing } from './listing';
import { statusOf, type Progress, type Status } from './progress';

interface ProblemListProps {
  problems: ProblemListing[];
  progress: Progress;
}

const STATUS_LABEL: Record<Status, string> = { todo: 'To do', attempted: 'Attempted', solved: 'Solved' };

/** Every problem with its difficulty, tags and status, filtered by those and by a search. */
export default function ProblemList({ problems, progress }: ProblemListProps) {
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Problem['difficulty']>('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const tags = useMemo(() => [...new Set(problems.flatMap((p) => p.tags))].sort(), [problems]);

  const shown = problems.filter(
    (p) =>
      (!difficulty || p.difficulty === difficulty) &&
      (!tag || p.tags.includes(tag)) &&
      (!status || statusOf(progress, p.id) === status) &&
      (!query || `${p.title} ${p.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())),
  );
  const solved = problems.filter((p) => statusOf(progress, p.id) === 'solved').length;
  const select = 'text-sm border border-gray-300 rounded-md px-2 py-2 sm:py-1.5 bg-white';

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold text-gray-900">System design practice</h1>
      <p className="mt-1 text-sm text-gray-600">
        Each problem gives use cases, traffic and requirements. Design the system in Proschi; the tests run in your browser and explain what holds up and
        what does not.
      </p>
      <p className="mt-2 text-sm text-gray-500">
        {solved} of {problems.length} solved
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">Search</span>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search problems"
            className="w-full text-sm border border-gray-300 rounded-md pl-8 pr-2 py-2 sm:py-1.5"
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
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} className={select}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {shown.map((p) => {
          const s = statusOf(progress, p.id);
          return (
            <li key={p.id}>
              <a href={`#/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <StatusIcon status={s} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-gray-900">{p.title}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="hidden sm:inline text-xs text-gray-500">{STATUS_LABEL[s]}</span>
                <DifficultyBadge difficulty={p.difficulty} />
              </a>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No problem matches these filters.</li>}
      </ul>
    </main>
  );
}
