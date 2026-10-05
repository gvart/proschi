import { use } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import LessonView from './LessonView';
import type { Guide } from './guide/guides';
import { primaryButton, toolButton } from '../components/Playground/ui';

// Each guide's Markdown is fetched when it is opened.
const files = import.meta.glob<string>('./guide/*.md', { query: '?raw', import: 'default' });
const cache = new Map<string, Promise<string | undefined>>();

function loadGuide(id: string): Promise<string | undefined> {
  let text = cache.get(id);
  if (!text) {
    const load = files[`./guide/${id}.md`];
    text = load
      ? load().catch((error) => {
          console.error(`Could not load guide ${id}:`, error);
          return undefined;
        })
      : Promise.resolve(undefined);
    cache.set(id, text);
  }
  return text;
}

/**
 * A roadmap article (guide/<id>.md) at practice/#/roadmap/<id>. Anyone can
 * read it: only starting the roadmap takes an account.
 */
export default function GuideRoute({ guide, startHref, startLabel }: { guide: Guide; startHref: string; startLabel: string }) {
  const source = use(loadGuide(guide.id));
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      <a href="#/roadmap" className={`-ml-2.5 ${toolButton}`}>
        <ArrowLeft size={16} />
        Roadmap
      </a>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Read first</p>
      <h1 className="mt-1 font-display text-[clamp(1.8rem,4.5vw,2.6rem)] font-extrabold leading-[1.08] tracking-[-0.02em] text-ink">{guide.title}</h1>
      <p className="mt-3 text-base text-ink/80">{guide.summary}</p>
      <div className="mt-6">
        {source === undefined ? (
          <p className="text-sm text-red-700 dark:text-red-300">This article could not be loaded; reload the page to try again.</p>
        ) : (
          <LessonView source={source} label="Guide" tocAlways large />
        )}
      </div>
      <p className="mt-10">
        <a href={startHref} className={primaryButton}>
          {startLabel}
          <ArrowRight size={14} />
        </a>
      </p>
    </main>
  );
}
