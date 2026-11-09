import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { sectionAnchor, type SectionId } from './settingsSections';

/**
 * The settings page's section list: sticky on the left from 900 px, a
 * compact "Jump to" menu above the sections on phones. Each entry scrolls
 * to its section (the page's address is its hash route, so no `#anchor`
 * links) and moves focus to its heading; the section in view is marked.
 */

/** A section counts as current once its top passes under the sticky header. */
const CURRENT_LINE = 160;

function useCurrentSection(ids: SectionId[]): [SectionId | undefined, (id: SectionId) => void] {
  const [current, setCurrent] = useState<SectionId | undefined>(ids[0]);
  const key = ids.join(' ');
  useEffect(() => {
    const list = key.split(' ') as SectionId[];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let found = list[0];
      for (const id of list) {
        const el = document.getElementById(sectionAnchor(id));
        if (el && el.getBoundingClientRect().top <= CURRENT_LINE) found = id;
      }
      setCurrent(atBottom && window.scrollY > 0 ? list[list.length - 1] : found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [key]);
  return [current, setCurrent];
}

function jumpTo(id: SectionId) {
  const section = document.getElementById(sectionAnchor(id));
  if (!section) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

export default function SettingsNav({ sections }: { sections: { id: SectionId; title: string }[] }) {
  const [current, setCurrent] = useCurrentSection(sections.map((s) => s.id));
  const menu = useRef<HTMLDetailsElement>(null);
  const go = (id: SectionId) => {
    setCurrent(id);
    if (menu.current) menu.current.open = false;
    jumpTo(id);
  };
  const currentTitle = sections.find((s) => s.id === current)?.title ?? sections[0]?.title;

  return (
    <>
      <nav aria-label="Settings sections" className="hidden min-[900px]:block">
        <ul className="sticky top-24 space-y-0.5 border-l-bw-1 border-ink/15">
          {sections.map(({ id, title }) => {
            const on = id === current;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => go(id)}
                  aria-current={on ? 'true' : undefined}
                  className={`-ml-[2px] block w-full border-l-bw-1 py-1.5 pl-4 pr-2 text-left text-sm transition-colors duration-d1 ${
                    on ? 'border-ink font-bold text-ink' : 'border-transparent text-muted hover:border-ink/40 hover:text-ink'
                  }`}
                >
                  {title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <details ref={menu} data-testid="settings-jump" className="group sticky top-[76px] z-10 -mx-4 border-b-bw-1 border-ink/15 bg-paper px-4 py-2 min-[900px]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm border-bw-1 border-ink bg-surface px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            <span className="text-muted">Jump to </span>
            <span className="font-semibold text-ink">{currentTitle}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform duration-d1 group-open:rotate-180" />
        </summary>
        <nav aria-label="Jump to a section" className="mt-1 rounded-sm border-bw-1 border-ink bg-surface py-1">
          <ul>
            {sections.map(({ id, title }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => go(id)}
                  aria-current={id === current ? 'true' : undefined}
                  className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-pop-yellow/30 ${id === current ? 'font-bold text-ink' : 'text-ink'}`}
                >
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </details>
    </>
  );
}
