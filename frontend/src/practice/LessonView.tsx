import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import Markdown from './Markdown';
import { lessonToc, parseMarkdown, type Block } from './markdown';
import { readingMinutes } from './lesson';
import { eyebrow, primaryButton } from '../components/Playground/ui';

/** "On this page": buttons, not `#` links, which would change the practice app's hash route. */
export function LessonToc({ blocks, root, className = '' }: { blocks: Block[]; /** Where the headings are: the page may hold others with the same ids (the statement). */ root: RefObject<HTMLElement | null>; className?: string }) {
  const toc = lessonToc(blocks);
  if (toc.length < 2) return null;
  return (
    <nav aria-label="Lesson contents" className={`rounded border-bw-1 border-ink bg-paper px-3 py-2 ${className}`}>
      <p className={eyebrow}>On this page</p>
      <ol className="mt-1 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
        {toc.map((entry, i) => (
          <li key={entry.id} className="min-w-0">
            <button
              type="button"
              onClick={() => root.current?.querySelector(`[id="${CSS.escape(entry.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="w-full truncate text-left text-ink/80 underline-offset-2 hover:text-ink hover:underline"
            >
              <span className="tabular-nums text-muted">{i + 1}.</span> {entry.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

interface LessonProps {
  source: string;
  /** "Start the challenge": shown at the top and the bottom when given. */
  onStart?: () => void;
  /** Show the table of contents on phones too (it is desktop-only by default). */
  tocAlways?: boolean;
  /** Article size (a page of its own) instead of the side panel's. */
  large?: boolean;
  /** The header's label and the article's name; "Lesson" by default. */
  label?: string;
  /** Called once the end of the text comes into view: the lesson counts as read. */
  onRead?: () => void;
}

/** Calls `onRead` once `end` scrolls into view (never without IntersectionObserver). */
function useReadToEnd(end: RefObject<HTMLElement | null>, onRead?: () => void) {
  const callback = useRef(onRead);
  callback.current = onRead;
  const wanted = onRead !== undefined;
  useEffect(() => {
    const target = end.current;
    if (!wanted || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      callback.current?.();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [end, wanted]);
}

/** A problem's lesson (lesson.md): the concepts first, then the way into the challenge. */
export default function LessonView({ source, onStart, tocAlways = false, large = false, label = 'Lesson', onRead }: LessonProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const minutes = useMemo(() => readingMinutes(source), [source]);
  const article = useRef<HTMLElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useReadToEnd(end, onRead);
  const start = onStart && (
    <button type="button" onClick={onStart} className={primaryButton}>
      Start the challenge
      <ArrowRight size={14} />
    </button>
  );
  return (
    <article ref={article} aria-label={label} className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="inline-flex items-center gap-1.5 text-sm text-ink/80">
          <BookOpen size={15} aria-hidden="true" />
          <span className={eyebrow}>{label}</span>
          <span className="tabular-nums">· {minutes} min read</span>
        </p>
        {start && <span className="ml-auto">{start}</span>}
      </header>
      <LessonToc blocks={blocks} root={article} className={tocAlways ? '' : 'hidden md:block'} />
      <Markdown source={source} blocks={blocks} large={large} />
      <div ref={end} aria-hidden="true" />
      {start && (
        <section aria-label="Your turn" className="rounded-brutal border-bw-2 border-ink bg-pop-yellow/25 p-4 shadow-brutal-sm">
          <p className="font-semibold text-ink">Your turn</p>
          <p className="mt-1 text-sm text-ink/80">Design it in Proschi: the tests check the ideas above under load, failures and a budget.</p>
          <div className="mt-3">{start}</div>
        </section>
      )}
    </article>
  );
}
