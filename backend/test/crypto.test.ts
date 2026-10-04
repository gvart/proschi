import { describe, expect, it } from 'vitest';
import { cleanName } from '../src/auth';
import { decodeJson, encodeJson, fromBase64url, sign, unsign } from '../src/crypto';

describe('signed values', () => {
  it('round-trip, and reject a changed value, signature or secret', async () => {
    const value = encodeJson({ a: 1, b: 'ü' });
    const signed = await sign(value, 'secret');
    expect(await unsign(signed, 'secret')).toBe(value);
    expect(decodeJson(value)).toEqual({ a: 1, b: 'ü' });
    expect(await unsign(signed, 'other')).toBeUndefined();
    expect(await unsign(`${encodeJson({ a: 2 })}${signed.slice(signed.indexOf('.'))}`, 'secret')).toBeUndefined();
    expect(await unsign(`${signed}x`, 'secret')).toBeUndefined();
    expect(await unsign('no-dot', 'secret')).toBeUndefined();
    expect(fromBase64url('not base64!')).toBeUndefined();
    expect(decodeJson('%%%')).toBeUndefined();
  });
});

describe('cleanName', () => {
  it('trims, collapses spaces, drops invisible characters and caps the length', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('a‮b​c\u0007')).toBe('abc');
    expect(cleanName('x'.repeat(100))).toHaveLength(40);
    expect(cleanName(' ​ ')).toBeUndefined();
  });
});
