/**
 * Voice mode's send-on-silence (docs/design/paid-plans.md P45): once a
 * finished phrase is in the box and nothing more was heard for AUTO_SEND_MS,
 * the answer goes. Pure, for the tests: the composer shows the countdown
 * from `autoSendLeft` and sends at 0.
 */

export const AUTO_SEND_MS = 1800;

export interface SpeechDraft {
  /** The draft has finished words in it. */
  text: string;
  /** Words still being spoken (not final yet). */
  interim: string;
  /** When words were last heard, ms; undefined before any. */
  heardAt?: number;
  /** The countdown was cancelled for this draft. */
  cancelled: boolean;
}

/** Milliseconds until the draft is sent, 0 to send now, or undefined while nothing is due (empty, still speaking, cancelled). */
export function autoSendLeft(draft: SpeechDraft, now: number, delay = AUTO_SEND_MS): number | undefined {
  if (draft.cancelled || draft.interim || !draft.text.trim() || draft.heardAt === undefined) return undefined;
  return Math.max(0, draft.heardAt + delay - now);
}
