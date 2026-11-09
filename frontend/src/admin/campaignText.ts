import type { Audience, AudienceCount, CampaignDraft } from './api';

/** The words of the Campaigns page: who an audience is, and what sending will do. */

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export function describeAudience(a: Audience): string {
  switch (a.type) {
    case 'all':
      return 'Every account';
    case 'plan':
      return `Accounts on ${a.plan[0].toUpperCase()}${a.plan.slice(1)}`;
    case 'active':
      return `Active in the last ${n(a.days, 'day')}`;
    case 'signup':
      return a.after && a.before ? `Signed up from ${a.after} to before ${a.before}` : a.after ? `Signed up on or after ${a.after}` : `Signed up before ${a.before ?? '—'}`;
    case 'user':
      return `One account (${a.id})`;
  }
}

/** Whether the audience is complete enough to count. */
export function audienceReady(a: Audience): boolean {
  if (a.type === 'active') return Number.isInteger(a.days) && a.days >= 1 && a.days <= 365;
  if (a.type === 'signup') return Boolean(a.after || a.before);
  if (a.type === 'user') return /^[\w-]{1,64}$/.test(a.id);
  return true;
}

/**
 * The confirm step's sentence: exactly what sending does, e.g. "Grant 150
 * credits to 30 accounts, email 27 and show the announcement to 30. 3 skipped:
 * 2 turned product news off, 1 has no confirmed address."
 */
export function summarize(d: Pick<CampaignDraft, 'credits' | 'email' | 'inapp'>, c: AudienceCount): { sentence: string; skipped?: string } {
  const parts: string[] = [];
  if (d.credits > 0) parts.push(`grant ${n(d.credits, 'credit')} to ${n(c.accounts, 'account')}`);
  if (d.email) parts.push(parts.length ? `email ${c.emails.toLocaleString('en-US')}` : `email ${n(c.emails, 'account')}`);
  if (d.inapp) parts.push(`show the announcement to ${parts.length ? c.accounts.toLocaleString('en-US') : n(c.accounts, 'account')}`);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'do nothing');
  const sentence = `${joined[0].toUpperCase()}${joined.slice(1)}.`;
  const skippedCount = c.optedOut + c.unconfirmed;
  if (!d.email || !skippedCount) return { sentence };
  const why = [c.optedOut ? `${c.optedOut.toLocaleString('en-US')} turned product news off` : '', c.unconfirmed ? `${c.unconfirmed.toLocaleString('en-US')} ${c.unconfirmed === 1 ? 'has' : 'have'} no confirmed address` : '']
    .filter(Boolean)
    .join(', ');
  return { sentence, skipped: `${skippedCount.toLocaleString('en-US')} skipped for email: ${why}.` };
}
