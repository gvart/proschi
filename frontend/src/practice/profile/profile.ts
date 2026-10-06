import type { Achievement, AchievementsAnswer, AchievementStatus } from '../../learn/achievements';
import type { ChallengeSummary } from '../../learn/challenge';
import type { PublicProfile } from '../../services/api';
import type { ProblemListing } from '../listing';
import { statusOf, type Progress } from '../progress';
import { DIFFICULTIES, type Problem } from '../types';

/**
 * What a profile page shows, whoever it belongs to: the account page
 * (`#/me`, from the learner's own data, with what only they see) and a
 * public profile (`#/u/<id>`, from GET /api/users/<id>/profile) render the
 * same layout (ProfileView) from this one shape.
 */

type Difficulty = Problem['difficulty'];

/** A badge as a profile shows it: progress only on the learner's own page. */
export interface ProfileBadge extends Achievement {
  earned: boolean;
  /** Unix seconds. */
  earnedAt?: number;
  /** Towards the badge, while it is locked; absent on a public profile. */
  progress?: { current: number; target: number };
}

export interface ProfileModel {
  displayName: string;
  /** Unix seconds; unknown without an account. */
  memberSince?: number;
  /** Days. `freezes` only on the learner's own page. */
  streak?: { current: number; longest: number; freezes?: number };
  /** The daily challenge streak (days) and best score; absent before a first challenge. */
  challenge?: ChallengeSummary;
  /** 0 to 1. */
  readiness: number;
  /** Each topic's mastery, 0 to 1. */
  topics: { topic: string; mastery: number }[];
  /** Every badge, earned or locked, in achievements.json's order. */
  badges: ProfileBadge[];
  /** The problems solved, in the list's order. */
  solved: { id: string; title: string; difficulty: Difficulty }[];
  /** Only on the learner's own page. */
  cards?: { reviewed: number; mastered: number };
}

/** Exactly what a public profile shows (backend/src/profile.ts; docs/PRIVACY.md says the same), as the account page words it. */
export const PUBLIC_FIELDS =
  'your display name, the month you joined, the problems you solved (not your designs), your current and longest streak, your daily challenge streak and best score, your interview-ready score, your mastery of each topic, and the badges you earned with their dates';

/** A profile route's user id: `u/<id>` gives `<id>` (empty when missing); undefined for any other route. */
export function profileIdOf(route: string): string | undefined {
  if (!route.startsWith('u/')) return undefined;
  const id = route.slice(2);
  return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : '';
}

/**
 * The practice page served at a profile's own address, `/u/<id>` (the
 * Worker's src/profilePage.ts), shows `#/u/<id>`: the address it should
 * have, or undefined when it is already at a practice address.
 */
export function profileAddressOf(pathname: string): string | undefined {
  const id = /^\/u\/([A-Za-z0-9-]{1,64})\/?$/.exec(pathname)?.[1];
  return id ? `/practice/#/u/${id}` : undefined;
}

/** A badge of GET /api/me/achievements (or its local twin) as a profile shows it: progress while locked. */
export function profileBadge(a: AchievementStatus): ProfileBadge {
  const { current, target, unseen, ...badge } = a;
  void unseen;
  return badge.earned ? badge : { ...badge, progress: { current, target } };
}

/** Problems solved per difficulty, every difficulty present. */
export function solvedByDifficulty(solved: readonly { difficulty: Difficulty }[]): Record<Difficulty, number> {
  const out = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
  for (const p of solved) out[p.difficulty] += 1;
  return out;
}

/** The problems of `ids` this build has, with their titles, in the list's order. */
function solvedProblems(problems: readonly ProblemListing[], ids: ReadonlySet<string>): ProfileModel['solved'] {
  return problems.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, title: p.title, difficulty: p.difficulty }));
}

/**
 * The learner's own profile: the achievements answer (badges with progress,
 * the skill map, card counts), the streak when known, and the problems this
 * browser's progress has solved (merged with the server's when signed in).
 */
export function ownProfile({
  displayName,
  memberSince,
  streak,
  challenge,
  answer,
  progress,
  problems,
}: {
  displayName: string;
  memberSince?: number;
  streak?: ProfileModel['streak'];
  challenge?: ChallengeSummary | null;
  answer: AchievementsAnswer;
  progress: Progress;
  problems: readonly ProblemListing[];
}): ProfileModel {
  return {
    displayName,
    memberSince,
    streak,
    ...(challenge ? { challenge } : {}),
    readiness: answer.skills.readiness,
    topics: answer.skills.topics,
    badges: answer.achievements.map(profileBadge),
    solved: solvedProblems(problems, new Set(problems.filter((p) => statusOf(progress, p.id) === 'solved').map((p) => p.id))),
    cards: { reviewed: answer.stats.reviews, mastered: answer.stats.mastered },
  };
}

/** Someone's public profile, with every badge of the catalog: the earned ones dated, the rest locked. */
export function publicProfile(profile: PublicProfile, catalog: readonly Achievement[], problems: readonly ProblemListing[]): ProfileModel {
  const earned = new Map(profile.badges.map((b) => [b.id, b.earnedAt]));
  return {
    displayName: profile.displayName,
    memberSince: profile.memberSince,
    streak: { current: profile.streak.current, longest: profile.streak.longest },
    ...(profile.challenge ? { challenge: { current: profile.challenge.current, longest: profile.challenge.longest, best: profile.challenge.best } } : {}),
    readiness: profile.readiness,
    topics: profile.topics,
    badges: catalog.map((a) => (earned.has(a.id) ? { ...a, earned: true, earnedAt: earned.get(a.id) } : { ...a, earned: false })),
    solved: solvedProblems(problems, new Set(profile.solved.map((p) => p.id))),
  };
}
