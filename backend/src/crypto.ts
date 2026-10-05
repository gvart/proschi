const encoder = new TextEncoder();

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Undefined for anything that is not base64url. */
export function fromBase64url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** `bytes` random bytes, base64url. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256 of the UTF-8 text, base64url: how tokens are stored, and the PKCE S256 challenge. */
export async function sha256(text: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `value.signature`; `value` must not contain a dot. */
export async function sign(value: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value));
  return `${value}.${base64url(signature)}`;
}

/** The value of a `sign`ed string, or undefined when the signature does not match. */
export async function unsign(signed: string, secret: string): Promise<string | undefined> {
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return undefined;
  const value = signed.slice(0, dot);
  const signature = fromBase64url(signed.slice(dot + 1));
  if (!signature) return undefined;
  return (await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(value))) ? value : undefined;
}

export function encodeJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

export function decodeJson(text: string): unknown {
  const bytes = fromBase64url(text);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Whether two strings are equal, in a time that does not depend on where they differ (for secrets such as a PKCE challenge). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
