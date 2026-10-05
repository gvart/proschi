import { ArrowRight, Layers } from 'lucide-react';
import summary from 'virtual:practice-cards-summary';
import { eyebrow } from '../components/Playground/ui';

/**
 * Daily review's card on the problem list, under the roadmap's: what it is
 * and the way in. Only the counts ship with the list; the cards load with
 * the review page.
 */
export default function ReviewCard() {
  if (summary.cards === 0) return null;
  return (
    <div className="mt-4 rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md overflow-hidden">
      <div className="h-3 bg-pop-blue border-b-bw-2 border-ink" aria-hidden="true" />
      <div className="p-5 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>A few minutes a day</p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold leading-tight text-ink">
            <Layers size={22} aria-hidden="true" className="shrink-0" />
            Daily review
          </h2>
          <p className="mt-2 text-sm text-ink/80">
            {summary.cards} cards in {summary.topics} topics: recall a concept, pick an option, estimate a number or fill a gap. Each comes back just before
            you would forget it.
          </p>
        </div>
        <a
          href="#/review"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start sm:self-auto min-h-[44px] px-4 rounded border-bw-2 border-ink bg-pop-yellow text-on-accent font-bold shadow-brutal-sm hover:shadow-brutal-md transition-[box-shadow,transform] duration-d1 hover:-translate-x-px hover:-translate-y-px"
        >
          Start daily review
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
