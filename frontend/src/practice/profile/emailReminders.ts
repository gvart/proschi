/**
 * Helpers of the email reminders form on the account page
 * (EmailReminders.tsx); the server checks the same things again
 * (backend/src/reminders.ts).
 */

/** A plausible address: one @, no spaces, a dot in the domain. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/.test(value);
}

/** This browser's IANA time zone, for sending reminders in the learner's evening; UTC when unknown. */
export function browserTimeZone(intl: typeof Intl = Intl): string {
  try {
    return intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The reminder kinds, in the order the form lists them. */
export const REMINDER_KINDS = [
  { key: 'streak', label: 'Streak at risk', hint: 'in the evening, when your streak would end and today’s goal isn’t met' },
  { key: 'cards', label: 'Cards due', hint: 'in the evening, when 5 or more review cards are due' },
  { key: 'recap', label: 'Weekly recap', hint: 'on Monday morning, your last week in numbers' },
] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number]['key'];
