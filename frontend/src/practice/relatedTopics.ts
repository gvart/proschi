import { useEffect, useState } from 'react';
import type { Topic } from '../learn/cards';

/** The topics of the cards whose `related:` names `problemId`, with how many; loaded with the deck, after the solve. */
export function useRelatedTopics(problemId: string): { topic: Topic; count: number }[] {
  const [topics, setTopics] = useState<{ topic: Topic; count: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    import('virtual:practice-cards').then(
      ({ default: deck }) => {
        if (cancelled) return;
        const related = deck.cards.filter((c) => !c.retired && c.related.includes(problemId));
        setTopics(
          deck.topics.map((topic) => ({ topic, count: related.filter((c) => c.topic === topic.id).length })).filter((t) => t.count > 0),
        );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [problemId]);
  return topics;
}
