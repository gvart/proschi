import { base64url } from '../src/crypto';

/**
 * A software passkey for the admin tests: an ES256 key pair that answers
 * WebAuthn registration and authentication requests the way a browser and
 * authenticator would (`none` attestation, user present and verified), so
 * the real verification in src/adminAuth.ts runs against it.
 */

type Cbor = number | string | Uint8Array | CborMap | { [key: string]: Cbor };
type CborMap = Map<number | string, Cbor>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Just enough CBOR for an attestation object and a COSE key. */
function cbor(value: Cbor): number[] {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return [...head(5, entries.length), ...entries.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

/** An ECDSA signature as DER, as authenticators send it (WebCrypto gives r ‖ s). */
function der(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.slice(i);
    const body = trimmed[0] & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, body.length, ...body];
  };
  const seq = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, seq.length, ...seq]);
}

function clientData(type: string, challenge: string, origin: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export interface Passkey {
  id: string;
  /** The answer to registration options (POST /api/admin/setup/options), as @simplewebauthn/browser sends it. */
  register(options: { challenge: string; rp: { id: string } }, origin: string): Promise<Record<string, unknown>>;
  /** The answer to authentication options; `overrides.id` sends it as another passkey's (a forged answer), `overrides.counter` sets the signature counter. */
  authenticate(options: { challenge: string; rpId?: string }, origin: string, overrides?: { id?: string; counter?: number }): Promise<Record<string, unknown>>;
}

export async function createPasskey(): Promise<Passkey> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const id = base64url(credentialId);
  const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const coseKey = new Map<number, Cbor>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, fromB64(jwk.x!)],
    [-3, fromB64(jwk.y!)],
  ]);
  let counter = 0;

  return {
    id,
    async register(options, origin) {
      const data = clientData('webauthn.create', options.challenge, origin);
      const rpIdHash = await sha256(new TextEncoder().encode(options.rp.id));
      const key = cbor(coseKey);
      const authData = new Uint8Array([
        ...rpIdHash,
        0x45, // user present, user verified, attested credential data
        0, 0, 0, 0,
        ...new Uint8Array(16), // AAGUID
        0, credentialId.length,
        ...credentialId,
        ...key,
      ]);
      const attestationObject = new Uint8Array(cbor({ fmt: 'none', attStmt: {}, authData }));
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: { clientDataJSON: base64url(data), attestationObject: base64url(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    async authenticate(options, origin, overrides = {}) {
      counter = overrides.counter ?? counter;
      const data = clientData('webauthn.get', options.challenge, origin);
      const rpIdHash = await sha256(new TextEncoder().encode(options.rpId ?? new URL(origin).hostname));
      const authData = new Uint8Array([...rpIdHash, 0x05, (counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
      const signed = new Uint8Array([...authData, ...(await sha256(data))]);
      const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
      const credential = overrides.id ?? id;
      return {
        id: credential,
        rawId: credential,
        type: 'public-key',
        response: {
          clientDataJSON: base64url(data),
          authenticatorData: base64url(authData),
          signature: base64url(der(signature)),
          userHandle: base64url(new TextEncoder().encode('proschi-admin')),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
