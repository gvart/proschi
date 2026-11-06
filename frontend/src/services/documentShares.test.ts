import { describe, expect, it } from 'vitest';
import { isPro, shareTokenFromPath } from './documentShares';

const TOKEN = 'AbCdEfGhIjKlMnOpQr-_12';

describe('shareTokenFromPath', () => {
  it('reads the token of /share/<token>, under any base path', () => {
    expect(shareTokenFromPath(`/share/${TOKEN}`)).toBe(TOKEN);
    expect(shareTokenFromPath(`/proschi/share/${TOKEN}/`)).toBe(TOKEN);
  });

  it('refuses anything else', () => {
    expect(shareTokenFromPath('/share/')).toBeUndefined();
    expect(shareTokenFromPath('/share/short')).toBeUndefined();
    expect(shareTokenFromPath(`/share/${TOKEN}x`)).toBeUndefined();
    expect(shareTokenFromPath(`/s/${TOKEN}`)).toBeUndefined();
    expect(shareTokenFromPath(`/share/${TOKEN.slice(1)}%`)).toBeUndefined();
  });
});

describe('isPro', () => {
  it('is the pro plan only', () => {
    expect(isPro('pro')).toBe(true);
    expect(isPro('free')).toBe(false);
    expect(isPro(undefined)).toBe(false);
  });
});
