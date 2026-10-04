import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSession, mergeServerProgress, newLoginNonce, progressToImport, saveSession, SESSION_KEY, takeLoginNonce, takeLoginParams } from './account';
import type { ServerProgress } from '../services/api';
import type { Progress } from './progress';

describe('takeLoginParams', () => {
  it('takes the code or error the API appended and keeps the rest of the URL', () => {
    expect(takeLoginParams('https://x.io/proschi/practice/?login=abc#/url-shortener')).toEqual({
      code: 'abc',
      cleanUrl: 'https://x.io/proschi/practice/#/url-shortener',
    });
    expect(takeLoginParams('https://x.io/practice/?a=1&login_error=cancelled')).toEqual({ error: 'cancelled', cleanUrl: 'https://x.io/practice/?a=1' });
    expect(takeLoginParams('https://x.io/practice/#/chat')).toEqual({ cleanUrl: 'https://x.io/practice/#/chat' });
  });
});

describe('login nonce', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is kept in the tab and taken once', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const nonce = newLoginNonce();
    expect(nonce).toMatch(/^[0-9a-f]{48}$/);
    expect(newLoginNonce()).not.toBe(nonce);
    const last = store.get('proschi.login-nonce');
    expect(takeLoginNonce()).toBe(last);
    expect(takeLoginNonce()).toBeUndefined();
  });

  it('is undefined when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(newLoginNonce()).toBeUndefined();
    expect(takeLoginNonce()).toBeUndefined();
  });
});

describe('session storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a session until it expires, and drops damaged ones', () => {
    saveSession({ token: 't', expiresAt: 2_000 });
    expect(loadSession(1_000_000)).toEqual({ token: 't', expiresAt: 2_000 });
    expect(loadSession(2_000_000)).toBeUndefined();
    localStorage.setItem(SESSION_KEY, '{"token": 1}');
    expect(loadSession(0)).toBeUndefined();
    saveSession(undefined);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

const server = (status: ServerProgress['status'], source?: string): ServerProgress => ({ status, runs: 1, ...(source ? { source } : {}) });

describe('mergeServerProgress', () => {
  it('takes the better status and keeps the browser’s design, filling in the server’s where the browser has none', () => {
    const local: Progress = { a: { status: 'attempted', source: 'local a' }, b: { status: 'solved', source: 'local b' }, c: { status: 'todo' } };
    expect(mergeServerProgress(local, { a: server('solved', 'server a'), b: server('attempted', 'server b'), c: server('attempted', 'server c'), d: server('solved', 'server d') })).toEqual({
      a: { status: 'solved', source: 'local a' },
      b: { status: 'solved', source: 'local b' },
      c: { status: 'attempted', source: 'server c' },
      d: { status: 'solved', source: 'server d' },
    });
  });
});

describe('progressToImport', () => {
  it('lists browser designs the server does not have', () => {
    const local: Progress = { a: { status: 'solved', source: 'a' }, b: { status: 'attempted', source: 'b' }, c: { status: 'attempted' }, d: { status: 'solved', source: 'd' } };
    expect(progressToImport(local, { d: server('attempted') })).toEqual([
      { id: 'a', source: 'a', solved: true },
      { id: 'b', source: 'b', solved: false },
    ]);
  });
});
