import { describe, expect, it } from 'vitest';
import { mergeServerProgress, progressToImport, takeLoginError } from './account';
import type { ServerProgress } from '../services/api';
import type { Progress } from './progress';

describe('takeLoginError', () => {
  it('takes the error the API appended and keeps the rest of the URL', () => {
    expect(takeLoginError('https://proschi.app/practice/?a=1&login_error=cancelled#/chat')).toEqual({
      error: 'cancelled',
      cleanUrl: 'https://proschi.app/practice/?a=1#/chat',
    });
    expect(takeLoginError('https://proschi.app/practice/#/chat')).toEqual({ cleanUrl: 'https://proschi.app/practice/#/chat' });
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
