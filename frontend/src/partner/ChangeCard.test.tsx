// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '../dsl';
import ChangeCard from './ChangeCard';
import type { Change } from './contract';

afterEach(cleanup);

// The preview draws with React Flow, which measures with ResizeObserver; jsdom has none.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const METRICS = { tests: null, p99Ms: 120, availability: 0.999, costPerMonth: 100 };
const BEFORE = 'api [REST API]\ndb [PostgreSQL]\napi -> db : SQL\n';
const AFTER = 'api [REST API]\ndb [PostgreSQL]\ncache [Redis]\napi -> db : SQL\napi -> cache : RESP\n';
const change: Change = {
  id: 'c1',
  title: 'Add a cache',
  why: 'Reads repeat',
  edits: [{ find: 'db [PostgreSQL]\n', replace: 'db [PostgreSQL]\ncache [Redis]\n' }, { find: 'api -> db : SQL\n', replace: 'api -> db : SQL\napi -> cache : RESP\n' }],
  result: { ok: true, source: AFTER, summary: ['adds cache'], before: METRICS, after: METRICS },
};

const card = (visual: boolean) =>
  render(
    <ChangeCard
      change={change}
      source={BEFORE}
      busy={false}
      onAccept={() => {}}
      onReject={() => {}}
      onUndo={() => {}}
      onImprove={async () => true}
      diagramOf={(s) => parse(s).diagram}
      visual={visual}
    />,
  );

describe('a proposed change', () => {
  it('offers its code diff in Code mode, folded under the picture', () => {
    card(false);
    expect(screen.getByText('Code')).toBeTruthy();
  });

  it('shows no code in Visual mode, only the design', () => {
    card(true);
    expect(screen.queryByText('Code')).toBeNull();
    expect(document.body.textContent).not.toContain('cache [Redis]');
    expect(document.body.textContent).not.toContain('api -> cache');
  });
});
