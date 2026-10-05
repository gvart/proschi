/**
 * "Something that can earn a badge just happened": a review session ended or
 * a test run finished (and, signed in, the server has it). The practice app
 * listens and checks for new achievements.
 */
export const ACTIVITY_EVENT = 'proschi:activity';

export function notifyActivity(): void {
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
}
