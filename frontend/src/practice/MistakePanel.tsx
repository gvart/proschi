import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Layers, Plus, TriangleAlert } from 'lucide-react';
import type { Card, Topic } from '../learn/cards';
import { promptOf } from '../learn/cards';
import type { Engine, TestResult } from '../hld/engine';
import { eyebrow, primaryButton, toolButton } from '../components/Playground/ui';
import { inlineText, parseMarkdown } from './markdown';
import { knownFailures, matchMistake } from './mistakes';
import { addToFocus } from './review/focus';
import type { Problem } from './types';

interface MistakePanelProps {
  problem: Problem;
  engine: Engine;
  /** The failed run's results. */
  results: TestResult[];
  /** Opens the lesson at a heading id. */
  onLesson: (id: string) => void;
}

/** A card's question as one short line of plain text. */
function shortPrompt(card: Card): string {
  const text = promptOf(card)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text;
}

/**
 * Under a failed run: the known mistake its failures match (src/practice/mistakes.ts),
 * why it fails, the lesson section that teaches the fix, and the review cards
 * that train it, which the learner can add to their review, due now. Loaded
 * lazily with the deck, after a failed run.
 */
export default function MistakePanel({ problem, engine, results, onLesson }: MistakePanelProps) {
  // What each wrong design fails: computed once per problem, so similar runs are told apart.
  const failures = useMemo(() => knownFailures(problem, engine), [problem, engine]);
  const match = useMemo(() => matchMistake(problem.wrong, results, failures), [problem.wrong, results, failures]);
  const section = useMemo(() => {
    const id = match?.mistake.lesson;
    if (!id || problem.lesson === undefined) return undefined;
    const heading = parseMarkdown(problem.lesson).find((b) => b.kind === 'heading' && b.id === id);
    return heading?.kind === 'heading' ? { id, text: inlineText(heading.children) } : undefined;
  }, [match, problem.lesson]);
  const deck = useDeck();
  const cards = (match?.mistake.cards ?? []).map((id) => deck?.cards.find((c) => c.id === id && !c.retired)).filter((c): c is Card => !!c);
  const [added, setAdded] = useState<string>();
  const key = match ? `${match.design}:${cards.map((c) => c.id).join(',')}` : undefined;

  if (!match) return null;
  const topicTitle = (id: string) => deck?.topics.find((t) => t.id === id)?.title ?? id;
  return (
    <section aria-label="Common mistake" className="m-3 rounded border-bw-2 border-ink bg-pop-yellow/20 p-3 shadow-brutal-sm">
      <h3 className="flex items-start gap-2 font-display text-base font-bold text-ink">
        <TriangleAlert size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Common mistake: {match.mistake.title}</span>
      </h3>
      <p className="mt-1 text-sm text-ink/85">{match.mistake.explain}</p>
      {section && (
        <button type="button" onClick={() => onLesson(section.id)} className={`mt-2 -ml-1 ${toolButton}`}>
          <BookOpen size={14} aria-hidden="true" />
          Lesson: {section.text}
        </button>
      )}
      {cards.length > 0 && (
        <div className="mt-3">
          <p className={eyebrow}>Cards that train it</p>
          <ul className="mt-1 space-y-1">
            {cards.map((card) => (
              <li key={card.id}>
                <a href={`cards/${card.topic}/${card.id}/`} className="flex items-start gap-2 text-sm text-ink hover:underline">
                  <Layers size={14} className="mt-0.5 flex-shrink-0 text-muted" aria-hidden="true" />
                  <span>
                    {shortPrompt(card)} <span className="text-xs text-muted">· {topicTitle(card.topic)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {added === key ? (
            <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
              <Check size={14} aria-hidden="true" />
              Added to your review, due now.
              <a href="#/review" className="inline-flex items-center gap-1 text-pop-blue hover:underline">
                Review them
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                addToFocus(cards.map((c) => c.id));
                setAdded(key);
              }}
              className={`mt-2 ${primaryButton}`}
            >
              <Plus size={14} aria-hidden="true" />
              Add these cards to my review
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The whole deck, loaded once the panel shows. */
function useDeck(): { cards: Card[]; topics: Topic[] } | undefined {
  const [deck, setDeck] = useState<{ cards: Card[]; topics: Topic[] }>();
  useEffect(() => {
    let cancelled = false;
    import('virtual:practice-cards').then(
      ({ default: bundle }) => {
        if (!cancelled) setDeck(bundle);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return deck;
}
