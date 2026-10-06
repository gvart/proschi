import type { DailyGoal, Streak, WeeklyRecap } from '../../frontend/src/learn/streak';
import { renderEmail, type EmailSpec } from './emailLayout';

/**
 * What each email says (src/reminders.ts sends them; src/emailLayout.ts draws
 * them): the confirmation, the three reminders, and the reminder that pauses
 * them. Only type imports, so scripts/email-preview.mjs can render these
 * outside the Worker with sample data.
 */

export type Kind = 'streak' | 'cards' | 'recap';

export interface ReminderData {
  streak?: Pick<Streak, 'current' | 'today'>;
  goal?: DailyGoal;
  due?: number;
  /** Titles of the topics most of the due cards are from, most first. */
  topics?: string[];
  recap?: WeeklyRecap;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Reminders unanswered in a row before they pause (src/reminders.ts PAUSE_AFTER). */
export const PAUSE_AFTER = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-09-28 as "Sep 28". */
const shortDay = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1] ?? day.slice(5, 7)} ${Number(day.slice(8, 10))}`;

const render = (spec: EmailSpec): RenderedEmail => ({ subject: spec.subject, ...renderEmail(spec) });

/** The double opt-in email: `link` opens the confirm page. */
export function confirmationEmail(link: string): RenderedEmail {
  return render({
    subject: 'Confirm your Proschi reminders',
    accent: 'blue',
    preheader: 'One click and Kernel starts watching your streak. The link works for two days.',
    badge: '✉ One last step',
    headline: 'Confirm your Proschi reminders',
    paragraphs: [
      'Confirm your email address to get Proschi reminders: a nudge when your streak is at risk or cards are due, and a weekly recap. At most one email a day.',
    ],
    cta: { label: 'Confirm my address', url: link },
    after: ['The link works for two days.'],
    kernel: 'Change request CR-001: "send this human friendly nudges". Kernel has already approved it. It just needs your signature. 🐾',
    footer: {
      why: "You got this because someone entered this address on their Proschi account page. If that wasn't you, ignore this email: nothing is sent to an unconfirmed address.",
      links: [],
    },
  });
}

const WHY: Record<Kind, string> = {
  streak: 'You got this because you turned on streak reminders on your Proschi account page.',
  cards: 'You got this because you turned on cards-due reminders on your Proschi account page.',
  recap: 'You got this because you turned on the weekly recap on your Proschi account page.',
};

function recapSentence(r: WeeklyRecap): string {
  const parts = [
    plural(r.reviews, 'card') + ' reviewed',
    ...(r.newCards ? [`${r.newCards} new`] : []),
    plural(r.solves, 'problem') + ' solved',
    ...(r.challenges ? [plural(r.challenges, 'daily challenge')] : []),
    ...(r.runs ? [plural(r.runs, 'Arcade run')] : []),
  ];
  return `Last week (${shortDay(r.start)} to ${shortDay(r.end)}): ${parts.join(', ')}. You met your daily goal on ${plural(r.goalDays, 'day')} of 7${r.streak ? `, and your streak was ${plural(r.streak, 'day')} on Sunday` : ''}.`;
}

type Body = Omit<EmailSpec, 'footer'>;

function streakEmail(origin: string, data: ReminderData): Body {
  const s = data.streak!;
  const goal = data.goal ?? { reviews: 10, solves: 1 };
  // The button asks for exactly what meets today's goal: the cards still left.
  const cards = Math.max(1, goal.reviews - s.today.reviews);
  const minutes = Math.max(1, Math.round(cards * 0.6));
  return {
    subject: `🔥 Day ${s.current} streak — don't let it go out`,
    accent: 'red',
    preheader: `Today's goal isn't met yet. ${plural(cards, 'card')} take about ${minutes} min.`,
    badge: '🔥 Streak alert',
    headline: 'Your streak ends tonight',
    hero: {
      value: String(s.current),
      label: `${s.current === 1 ? 'day' : 'days'} in a row`,
      note: `Today's goal: ${plural(goal.reviews, 'card')} or ${plural(goal.solves, 'solved problem')}. So far: ${s.today.reviews}/${goal.reviews} cards.`,
    },
    paragraphs: [
      `You're on a ${s.current}-day streak, and today's goal isn't met yet. A few cards, the daily challenge or an Arcade run keeps it going.`,
    ],
    cta: { label: `${s.today.reviews > 0 ? 'Do the last' : 'Do'} ${plural(cards, 'card')} (${minutes} min)`, url: `${origin}/practice/#/review` },
    secondary: { label: 'Or try the daily challenge', url: `${origin}/practice/#/challenge` },
    kernel: `🔥 Your ${s.current}-day streak is on fire... literally. Kernel is pacing the server room with a tiny extinguisher.`,
  };
}

function cardsEmail(origin: string, data: ReminderData): Body {
  const n = data.due!;
  return {
    subject: `🧠 ${plural(n, 'card')} ${n === 1 ? 'is' : 'are'} due — review before they fade`,
    accent: 'yellow',
    preheader: `${plural(n, 'card')} ${n === 1 ? 'is' : 'are'} ready for review. A few minutes now saves relearning later.`,
    badge: '🧠 Cards due',
    headline: 'Fresh cards, hot off the queue',
    hero: { value: String(n), label: `${n === 1 ? 'card' : 'cards'} due today` },
    paragraphs: [`${plural(n, 'card')} ${n === 1 ? 'is' : 'are'} due today. Reviewing them now, before you forget, is what makes them stick.`],
    ...(data.topics?.length ? { chips: { title: 'From', items: data.topics } } : {}),
    cta: { label: 'Review now', url: `${origin}/practice/#/review` },
    kernel: `Kernel paged you: ${plural(n, 'card')} just breached ${n === 1 ? 'its' : 'their'} review SLO. Kernel has already knocked one off the desk to make room. 🐾`,
  };
}

function recapEmail(origin: string, data: ReminderData): Body {
  const r = data.recap!;
  const great = r.goalDays >= 5;
  return {
    subject: `📊 Your Proschi week: ${plural(r.goalDays, 'goal day')}`,
    accent: 'green',
    preheader: `${plural(r.reviews, 'review')}, ${plural(r.solves, 'solve')}, ${r.goalDays}/7 goal days. Here's your week.`,
    badge: '📊 Weekly recap',
    headline: great ? 'What a week. Ship it.' : 'Your week, in numbers',
    paragraphs: [recapSentence(r)],
    stats: [
      { value: String(r.reviews), label: 'Reviews', accent: 'yellow' },
      { value: String(r.solves), label: 'Solves', accent: 'green' },
      { value: String(r.challenges), label: 'Challenges', accent: 'pink' },
      { value: String(r.runs), label: 'Arcade runs', accent: 'blue' },
      { value: `${r.goalDays}/7`, label: 'Goal days', accent: 'lilac' },
      { value: String(r.streak), label: 'Day streak', accent: 'red' },
    ],
    cta: { label: 'Keep going', url: `${origin}/practice/#/review` },
    secondary: { label: 'See your progress', url: `${origin}/practice/#/progress` },
    kernel: great
      ? 'Kernel reviewed the dashboards: all green. Purring at five nines of uptime.'
      : "Kernel's weekly incident report: no outages, just headroom. Same time next week?",
  };
}

/** The reminder that pauses them (the PAUSE_AFTER-th unanswered in a row): says why, and how to resume. */
function pausedEmail(kind: Kind, origin: string, data: ReminderData, body: Body): Body {
  const reason =
    kind === 'streak'
      ? `Your ${data.streak!.current}-day streak is still at risk tonight: today's goal isn't met yet.`
      : kind === 'cards'
        ? `${plural(data.due!, 'card')} ${data.due === 1 ? 'is' : 'are'} due today.`
        : recapSentence(data.recap!);
  return {
    subject: '💤 We paused your Proschi reminders',
    accent: 'lilac',
    preheader: 'This is the last reminder until you turn them back on. One click resumes them.',
    badge: '💤 Paused',
    headline: 'Reminders paused',
    hero: { value: '💤', label: 'Last email for now' },
    paragraphs: [
      reason,
      `We haven't seen you practice since our last ${plural(PAUSE_AFTER - 1, 'email')}, so we paused your reminders: this is the last one until you turn them back on.`,
    ],
    cta: { label: 'Resume reminders', url: `${origin}/practice/#/me` },
    secondary: { label: body.cta.label, url: body.cta.url },
    kernel: 'Kernel has muted the pager and gone back to napping on the warm rack. Wake the cat whenever you are ready. 😴',
  };
}

/** A reminder of `kind`, with the footer's links; `paused` makes it the one that pauses them. */
export function reminderEmail(
  kind: Kind,
  data: ReminderData,
  opts: { origin: string; unsubscribeUrl: string; paused?: boolean },
): RenderedEmail {
  const { origin } = opts;
  let body = kind === 'streak' ? streakEmail(origin, data) : kind === 'cards' ? cardsEmail(origin, data) : recapEmail(origin, data);
  if (opts.paused) body = pausedEmail(kind, origin, data, body);
  return render({
    ...body,
    footer: {
      why: WHY[kind],
      links: [
        { label: 'Change which emails you get', url: `${origin}/practice/#/me` },
        { label: 'Unsubscribe from all Proschi emails', url: opts.unsubscribeUrl },
      ],
    },
  });
}
