import { base64url, fromBase64url, timingSafeEqual } from './crypto';

/**
 * Passwords of email sign-in (src/emailAuth.ts): PBKDF2-SHA256 through
 * WebCrypto with a random 16-byte salt per password, stored as
 * `pbkdf2$sha256$<iterations>$<salt>$<hash>` (base64url). 100,000 iterations
 * is the most workerd allows (it refuses more), so that is what is used; the
 * count is stored, so it can be raised later and old hashes still verify.
 */

export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(await derive(password, salt, PBKDF2_ITERATIONS))}`;
}

/** A hash no password matches, verified when the address has no account, so that answer takes as long as a wrong password. */
const DUMMY = `pbkdf2$sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

/** Whether `password` matches `stored` (undefined: no account; the work is done anyway). Constant-time compare. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [scheme, hash, rounds, salt64, expected] = (stored ?? DUMMY).split('$');
  const iterations = Number(rounds);
  const salt = fromBase64url(salt64 ?? '');
  if (scheme !== 'pbkdf2' || hash !== 'sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt || !expected) return false;
  const actual = base64url(await derive(password, salt, iterations));
  return timingSafeEqual(actual, expected) && stored !== undefined;
}

/**
 * Common passwords of at least MIN_PASSWORD characters (shorter ones are
 * refused anyway), lowercased: from the top of the public breach lists.
 */
const COMMON = new Set([
  '1234567890', '0123456789', '0987654321', '1122334455', '1111111111', '0000000000', '1234512345', '1234567891', '12345678910', '123456789a',
  '123456789q', 'a123456789', 'qwertyuiop', 'qwertyuiop1', 'qwerty1234', 'qwerty12345', 'qwerty123456', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4t5',
  'q1w2e3r4t5y6', 'zaq12wsxcde3', '1qaz2wsx3edc', 'zxcvbnm123', 'asdfghjkl1', 'asdfghjkl;', 'password12', 'password123', 'password1234', 'password12345',
  'password!1', 'passw0rd123', 'p@ssw0rd123', 'p@ssword123', 'iloveyou12', 'iloveyou123', 'princess123', 'sunshine123', 'football123', 'baseball123',
  'superman123', 'starwars123', 'whatever123', 'trustno1234', 'letmein123', 'letmein1234', 'welcome123', 'welcome1234', 'welcome2024', 'welcome2025',
  'welcome2026', 'changeme123', 'administrator', 'admin12345', 'admin123456', 'adminadmin', 'monkey12345', 'dragon12345', 'master12345', 'michael123',
  'jennifer123', 'chocolate1', 'basketball', 'basketball1', 'christopher', 'butterfly1', 'liverpool1', 'manchester', 'football1', 'computer123',
  'internet123', 'mypassword', 'mypassword1', 'passwordpassword', 'abcdefghij', 'abcdefg123', 'abcd123456', 'abc1234567', 'aaaaaaaaaa', 'qqqqqqqqqq',
  '9876543210', '5555555555', '7777777777', '8888888888', '1212121212', '1231231231', '1234554321', 'qazwsxedc123', 'qazwsxedcrfv', '!qaz2wsx3edc',
  'iloveyou!!', 'secret1234', 'summer2024', 'summer2025', 'summer2026', 'winter2024', 'winter2025', 'winter2026', 'spring2025', 'autumn2025',
  'proschi123', 'proschi1234', 'proschiapp', 'systemdesign', 'system design', 'correcthorsebatterystaple',
]);

/** Why the password can't be used, or undefined when it can. */
export function passwordProblem(password: unknown, email?: string): string | undefined {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too common; pick another';
  if (email && (lower === email.toLowerCase() || lower === email.toLowerCase().split('@')[0])) return "Don't use your email address as the password";
  return undefined;
}
