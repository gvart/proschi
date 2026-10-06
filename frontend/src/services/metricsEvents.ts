/**
 * The product metrics' events (docs/PRIVACY.md, "Usage counts"): the page
 * counts them with `track` (src/services/metrics.ts), the Worker keeps one
 * number per UTC day and event (backend/src/metrics.ts). Nothing else is
 * sent: no user, no IP, no page address, no problem id.
 */
export const METRIC_EVENTS = [
  'landing_view',
  'editor_open',
  'editor_first_edit',
  'simulation_run',
  'test_run',
  'share_link_created',
  'export',
  'practice_open',
  'problem_start',
  'problem_solve',
  'card_review_session',
  'challenge_complete',
  'arcade_run_start',
  'arcade_run_end',
  'sign_in',
] as const;

export type MetricEvent = (typeof METRIC_EVENTS)[number];

/**
 * Counted by the Worker itself, never sent by a page: a sign-in (the OAuth
 * callback). `problem_solve` is both: the Worker counts a signed-in user's
 * first verified solve, and the page sends it only when signed out or on a
 * copy without accounts, so a solve counts once.
 */
export const SERVER_ONLY_EVENTS: readonly MetricEvent[] = ['sign_in'];

/** The events a page may send. */
export type ClientMetricEvent = Exclude<MetricEvent, 'sign_in'>;

/** At most this many events in one POST /api/metrics. */
export const MAX_METRIC_BATCH = 20;

export function isClientMetricEvent(value: unknown): value is ClientMetricEvent {
  return typeof value === 'string' && (METRIC_EVENTS as readonly string[]).includes(value) && !SERVER_ONLY_EVENTS.includes(value as MetricEvent);
}
