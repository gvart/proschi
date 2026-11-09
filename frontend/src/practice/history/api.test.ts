import { describe, expect, it } from 'vitest';
import { pickHref, pickTitle, verdictHref, verdictIdOf } from './api';

describe('the AI roadmap picks and the history, on the page', () => {
  it('links a pick to its roadmap step or its card deck, with its title', () => {
    expect(pickHref({ kind: 'problem', id: 'pastebin' })).toBe('#/roadmap/pastebin');
    expect(pickHref({ kind: 'cards', id: 'caching' })).toBe('#/review/caching');
    expect(pickTitle({ kind: 'problem', id: 'pastebin' }, (id) => (id === 'pastebin' ? 'Pastebin' : undefined))).toBe('Pastebin');
    expect(pickTitle({ kind: 'cards', id: 'caching' }, () => undefined)).toBe('Caching');
    expect(pickTitle({ kind: 'cards', id: 'gone' }, () => undefined)).toBe('gone');
  });

  it('reads the session id of a verdict address back', () => {
    expect(verdictIdOf(verdictHref('a b').slice(2))).toBe('a b');
    expect(verdictIdOf('progress')).toBeUndefined();
    expect(verdictIdOf('progress/interview/')).toBeUndefined();
    expect(verdictIdOf('progress/interview/x/y')).toBeUndefined();
  });
});
