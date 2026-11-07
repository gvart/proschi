import type { Env } from './env';
import { now } from './env';
import { errorText, log } from './log';

/**
 * The contact address of a GitHub or Google account (`contact_emails`,
 * migration 0028; docs/PRIVACY.md "Product news"): the provider's verified
 * address, saved on every sign-in with it, for account and product news
 * email only. It is never a sign-in identity: nothing finds, links or merges
 * an account by it (the identity HMACs of src/signupChecks.ts stay as they are).
 */

const MAX_EMAIL = 254;

/** Saves the address the provider verified (lowercased); nothing without one. A failure is logged, never the sign-in's. */
export async function saveContactEmail(env: Env, userId: string, provider: string, verifiedEmail: string | undefined): Promise<void> {
  const email = verifiedEmail?.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL || !email.includes('@')) return;
  try {
    await env.DB.prepare(
      `INSERT INTO contact_emails (user_id, email, provider, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET email = ?2, provider = ?3, updated_at = ?4`,
    )
      .bind(userId, email, provider, now())
      .run();
  } catch (e) {
    log('warn', 'Saving the contact address failed', { error: errorText(e) });
  }
}

/**
 * SQL for the address product news goes to, for the users row `u`: the
 * confirmed email sign-in address, else the verified address of a GitHub or
 * Google sign-in. Never the reminders' address (email_prefs): it was given
 * for reminders only. Another source goes here.
 */
export const newsAddressSql = (u: string): string =>
  `COALESCE((SELECT el.email FROM email_logins el WHERE el.user_id = ${u}.id AND el.confirmed_at IS NOT NULL), (SELECT ce.email FROM contact_emails ce WHERE ce.user_id = ${u}.id))`;
