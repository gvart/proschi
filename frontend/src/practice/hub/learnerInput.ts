import deck from 'virtual:practice-cards';
import problems from 'virtual:practice-listings';
import { relatedProblems, skills as skillMap } from '../../learn/mastery';
import type { NextStepsInput } from '../../learn/nextSteps';
import { overview } from '../../learn/review';
import type { Progress } from '../progress';
import { loadMistakes } from './recentMistakes';
import type { TodayCards } from './todayCards';

/**
 * What the recommender knows of this learner (also the interview-date plan's,
 * plan/PlanPanel.tsx): the skill map, the cards due, the problems solved or
 * started and the mistakes kept in this browser.
 */
export function learnerInput(progress: Progress, today: TodayCards, skills: readonly { topic: string; mastery: number }[] | undefined, now: number): Pick<NextStepsInput, 'topics' | 'due' | 'problems' | 'solved' | 'attempted' | 'mistakes'> {
  const solved = Object.keys(progress).filter((id) => progress[id].status === 'solved');
  const attempted = Object.keys(progress).filter((id) => progress[id].status === 'attempted');
  const stats = overview(deck.cards, today.loaded.states, deck.topics, { now, deck: today.signedOut ? 'sample' : undefined });
  const mastery = new Map(
    (skills ?? skillMap({ cards: deck.cards, topics: deck.topics, states: today.loaded.states, now, problems, solved, estimateRatings: [] }).topics).map((t) => [t.topic, t.mastery]),
  );
  return {
    topics: deck.topics.filter((t) => mastery.has(t.id)).map((t) => ({ id: t.id, title: t.title, mastery: mastery.get(t.id)!, related: relatedProblems(t.id, deck.cards, problems) })),
    due: { total: stats.due, byTopic: Object.fromEntries(stats.topics.map((t) => [t.topic.id, t.due])) },
    problems,
    solved,
    attempted,
    mistakes: loadMistakes(),
  };
}
