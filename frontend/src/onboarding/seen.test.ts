import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_KEY, hasSeen, markSeen, requestTour, resetOnboardingMemory, startMode, tourParam } from './seen';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function blockedWindow() {
  const deny = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  const win = { location: { search: '' } };
  Object.defineProperty(win, 'localStorage', { get: deny });
  Object.defineProperty(win, 'sessionStorage', { get: deny });
  return win;
}

describe('onboarding seen state', () => {
  let local: Storage;
  let session: Storage;

  beforeEach(() => {
    resetOnboardingMemory();
    local = memoryStorage();
    session = memoryStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session, location: { search: '' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts the tour on a first visit and not after it was seen', () => {
    expect(startMode('editor')).toBe('tour');
    markSeen('editor');
    expect(JSON.parse(local.getItem(ONBOARDING_KEY)!)).toEqual({ editor: true });
    resetOnboardingMemory();
    expect(startMode('editor')).toBeNull();
    expect(startMode('practice')).toBe('tour');
  });

  it('keeps other tours when marking one', () => {
    markSeen('editor');
    markSeen('practice');
    expect(JSON.parse(local.getItem(ONBOARDING_KEY)!)).toEqual({ editor: true, practice: true });
  });

  it('only hints over a deep link', () => {
    expect(startMode('editor', { deepLink: true })).toBe('hint');
    markSeen('editor');
    expect(startMode('editor', { deepLink: true })).toBeNull();
  });

  it('skips returning users and remembers them', () => {
    expect(startMode('editor', { returning: true })).toBeNull();
    expect(hasSeen('editor')).toBe(true);
  });

  it('honours ?tour=1 and ?tour=0', () => {
    expect(tourParam('?tour=1')).toBe('on');
    expect(tourParam('?a=b&tour=0')).toBe('off');
    expect(tourParam('?tour=yes')).toBeNull();
    markSeen('editor');
    expect(startMode('editor', { search: '?tour=1', deepLink: true })).toBe('tour');
    resetOnboardingMemory();
    local.clear();
    expect(startMode('editor', { search: '?tour=0' })).toBeNull();
  });

  it('starts a requested tour once', () => {
    markSeen('practice');
    requestTour('practice');
    expect(startMode('practice')).toBe('tour');
    expect(startMode('practice')).toBe('tour'); // state initializers may run twice
    markSeen('practice');
    expect(startMode('practice')).toBeNull();
  });

  it('ignores damaged stored values', () => {
    local.setItem(ONBOARDING_KEY, '[true]');
    expect(hasSeen('editor')).toBe(false);
    local.setItem(ONBOARDING_KEY, '{oops');
    expect(hasSeen('editor')).toBe(false);
    markSeen('editor');
    expect(JSON.parse(local.getItem(ONBOARDING_KEY)!)).toEqual({ editor: true });
  });

  it('falls back to sessionStorage when localStorage throws', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } },
      sessionStorage: session,
      location: { search: '' },
    });
    markSeen('editor');
    expect(JSON.parse(session.getItem(ONBOARDING_KEY)!)).toEqual({ editor: true });
    resetOnboardingMemory();
    expect(hasSeen('editor')).toBe(true);
  });

  it('shows once per session with all storage blocked, without throwing', () => {
    vi.stubGlobal('window', blockedWindow());
    expect(startMode('editor')).toBe('tour');
    expect(() => markSeen('editor')).not.toThrow();
    expect(startMode('editor')).toBeNull();
  });
});
