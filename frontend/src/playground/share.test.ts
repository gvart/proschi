import { describe, expect, it } from 'vitest';
import { ecommerceExample } from '../dsl';
import { decodeShareHash, encodeShareHash, shareUrl } from './share';

describe('share links', () => {
  it('round-trips a document through the hash', () => {
    const hash = encodeShareHash(ecommerceExample);
    expect(hash.startsWith('#code=')).toBe(true);
    expect(hash).toMatch(/^#code=[A-Za-z0-9+\-$]*$/);
    expect(decodeShareHash(hash)).toBe(ecommerceExample);
  });

  it('keeps unicode and payload characters intact', () => {
    const src = 'title "Café ☕"\na -> b : POST /x {"q": "#1 & 2"}';
    expect(decodeShareHash(encodeShareHash(src))).toBe(src);
  });

  it('ignores other or corrupt hashes', () => {
    expect(decodeShareHash('')).toBeNull();
    expect(decodeShareHash('#other=1')).toBeNull();
    expect(decodeShareHash('#code=')).toBeNull();
    expect(decodeShareHash('#code=%%%not-lz')).toBeNull();
  });

  it('builds a full URL that keeps the page path', () => {
    const url = shareUrl('a -> b', { origin: 'https://gvart.github.io', pathname: '/proschi/', search: '' });
    expect(url.startsWith('https://gvart.github.io/proschi/#code=')).toBe(true);
  });
});
