import { describe, expect, it } from 'vitest';
import { scopesText, SCOPE_LABEL } from './appScopes';

describe('app sign-in scopes in Settings', () => {
  it('names what the tokens may do', () => {
    expect(scopesText(['profile:read', 'documents:read'])).toBe('Can read your name and read your synced diagrams.');
    expect(scopesText(['profile:read', 'documents:read', 'documents:write', 'progress'])).toBe(
      'Can read your name, read your synced diagrams, change your synced diagrams and record practice progress.',
    );
    expect(scopesText([])).toBe('Can only read public pages.');
    expect(scopesText(['new:scope'])).toBe('Can new:scope.');
  });

  it('labels every scope the Worker issues (backend/src/scopes.ts TOKEN_SCOPES)', () => {
    expect(Object.keys(SCOPE_LABEL)).toEqual(['profile:read', 'documents:read', 'documents:write', 'progress']);
  });
});
