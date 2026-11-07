import { useId, useMemo, useState } from 'react';
import { ChevronDown, Dices, RotateCcw, SlidersHorizontal, TextSearch } from 'lucide-react';
import listings from 'virtual:practice-listings';
import { toolButton } from '../../components/Playground/ui';
import { DIFFICULTIES, type Problem } from '../types';
import { DifficultyBadge } from '../Badges';
import type { ProblemListing } from '../listing';
import { poolTopics } from './pick';
import { titleOf, type ProblemChoice } from './setupSteps';
import { RadioGroup, Tag, type RadioOption } from './wizard';

/**
 * The wizard's problem screen (Setup.tsx): "Surprise me" (the default, with
 * its difficulty and topic filters folded under Filters), "Choose a problem"
 * (the searchable picker), or the same one as last time.
 */

/** Topics shown before "More topics": the most common ones. */
const TOPICS_SHOWN = 10;

interface ProblemStepProps {
  choice: ProblemChoice;
  onChoice: (choice: ProblemChoice) => void;
  chosen?: string;
  onPick: () => void;
  last?: string;
  difficulty?: Problem['difficulty'];
  onDifficulty: (d: Problem['difficulty'] | undefined) => void;
  topic: string;
  onTopic: (t: string) => void;
  pool: readonly ProblemListing[];
  done: readonly string[];
}

export default function ProblemStep({ choice, onChoice, chosen, onPick, last, difficulty, onDifficulty, topic, onTopic, pool, done }: ProblemStepProps) {
  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [allTopics, setAllTopics] = useState(false);
  const topics = useMemo(() => poolTopics(listings), []);
  const shownTopics = allTopics ? topics : topics.slice(0, TOPICS_SHOWN).concat(topic && topics.indexOf(topic) >= TOPICS_SHOWN ? [topic] : []);
  const fresh = pool.filter((p) => !done.includes(p.id)).length;
  const active = [difficulty, topic].filter(Boolean) as string[];

  const options: RadioOption<ProblemChoice>[] = [
    {
      value: 'surprise',
      title: 'Surprise me',
      tag: <Tag tone="accent">Recommended</Tag>,
      icon: <Dices size={20} />,
      description: 'A random problem you haven’t done in an interview yet. You see it when the interview starts, as in a real one.',
    },
    {
      value: 'choose',
      title: 'Choose a problem',
      icon: <TextSearch size={20} />,
      description: 'Pick one by name or topic from a searchable list.',
    },
  ];
  if (last) options.push({ value: 'last', title: 'Same as last time', icon: <RotateCcw size={20} />, description: titleOf(last) });

  return (
    <div className="space-y-5">
      <RadioGroup label="Problem" options={options} value={choice} onChange={onChoice} />

      {choice === 'surprise' && (
        <div className="rounded-sm border-bw-1 border-ink/20 bg-paper/60 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <button type="button" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((o) => !o)} className={`${toolButton} -ml-1`}>
              <SlidersHorizontal size={15} aria-hidden="true" />
              Filters
              {active.length > 0 && <span className="font-normal capitalize text-muted">· {active.join(' · ')}</span>}
              <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-d1 ${filtersOpen ? 'rotate-180' : ''}`} />
            </button>
            <p className="text-xs text-muted" data-testid="pool-size" aria-live="polite">
              {pool.length === 0 ? 'No problem matches these filters.' : `${pool.length} problem${pool.length === 1 ? '' : 's'} to draw from, ${fresh} not done yet.`}
            </p>
          </div>
          {filtersOpen && (
            <div id={filtersId} className="space-y-4 pb-2 pt-3">
              <div>
                <p className="mb-2 text-sm font-bold text-ink">Difficulty</p>
                <RadioGroup<'any' | Problem['difficulty']>
                  label="Difficulty"
                  variant="chip"
                  value={difficulty ?? 'any'}
                  onChange={(d) => onDifficulty(d === 'any' ? undefined : d)}
                  options={(['any', ...DIFFICULTIES] as const).map((d) => ({ value: d, title: d[0].toUpperCase() + d.slice(1) }))}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-ink">Topic</p>
                <RadioGroup label="Topic" variant="chip" value={topic} onChange={onTopic} options={[{ value: '', title: 'Any' }, ...shownTopics.map((t) => ({ value: t, title: t.replace(/-/g, ' ') }))]} />
                {topics.length > TOPICS_SHOWN && (
                  <button type="button" onClick={() => setAllTopics((a) => !a)} className={`${toolButton} -ml-1 mt-2 text-xs`}>
                    {allTopics ? 'Fewer topics' : `All ${topics.length} topics`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {choice === 'choose' && chosen && (
        <div className="flex items-center gap-3 rounded-sm border-bw-1 border-ink bg-paper/60 p-3" data-testid="chosen-problem">
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-ink">{titleOf(chosen)}</span>
            <span className="block truncate text-xs text-muted">{listings.find((p) => p.id === chosen)?.summary}</span>
          </span>
          <DifficultyBadge difficulty={listings.find((p) => p.id === chosen)?.difficulty ?? 'easy'} />
          <button type="button" onClick={onPick} className={toolButton}>
            Change
          </button>
        </div>
      )}
    </div>
  );
}
