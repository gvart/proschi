// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allUnlocks, playScript, type ScriptedRun } from '../engine/check';
import { readContent } from '../engine/content';
import { emptyMeta } from '../engine/meta';
import type { Action, RunSetup } from '../engine/types';
import { markSeen } from '../../onboarding/seen';
import RunScreen from './RunScreen';
import type { Arcade } from './useArcade';

// The board is React Flow on a canvas: these tests drive the run through its buttons, not the board.
vi.mock('./GameCanvas', () => ({ default: () => <div data-testid="board" /> }));
vi.mock('./sound', () => ({ play: () => {}, buzz: () => {}, setSound: () => {} }));
vi.mock('../../design/celebrate', () => ({ celebrate: () => Promise.resolve() }));
// The review cards are a build-time bundle (plugins/practiceCards.ts); the run only links to them.
vi.mock('virtual:practice-cards', () => ({ default: { cards: [], topics: [] } }));

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);

const setup = (over: Partial<RunSetup> = {}): RunSetup => ({
  scenario: 'shortly',
  seed: 'ui',
  ascension: 0,
  mode: 'normal',
  loadout: { unlocked: allUnlocks(content), perks: {} },
  twists: false,
  ...over,
});

function arcade(): Arcade {
  return {
    meta: emptyMeta(),
    signedIn: false,
    busy: false,
    best: {},
    daily: { day: '2026-10-06', scenario: 'shortly', played: false },
    buy: vi.fn(async () => {}),
    equip: vi.fn(async () => {}),
    start: vi.fn(async () => ({ setup: setup() })),
    finish: vi.fn(async (game) => ({ score: game.state.score, blueprints: 7, firstClear: false })),
  };
}

function renderRun(over: { setup?: RunSetup; resume?: Action[]; arcade?: Arcade } = {}) {
  const props = {
    content,
    setup: over.setup ?? setup(),
    resume: over.resume,
    arcade: over.arcade ?? arcade(),
    settings: { sound: false, speed: 4 as const, mascot: false },
    onSettings: vi.fn(),
    onExit: vi.fn(),
    onAgain: vi.fn(),
  };
  return { ...render(<RunScreen {...props} />), props };
}

beforeEach(() => {
  localStorage.clear();
  // A returning player: no first-wave tutorial and no intro to the twists.
  markSeen('arcade');
  markSeen('arcade-twists');
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
});
afterEach(cleanup);

describe('RunScreen', () => {
  it('plans, deploys, shows the wave result, drafts, and plans the next wave', async () => {
    renderRun();
    // Planning: the forecast and the deploy button.
    expect(screen.getByRole('region', { name: 'Forecast' }).textContent).toContain('Wave 1');
    fireEvent.click(screen.getByRole('button', { name: /Deploy wave 1/ }));
    // The run: playback controls instead of the deploy button.
    expect(screen.queryByRole('button', { name: /Deploy wave/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    // The wave's result.
    const result = screen.getByRole('dialog', { name: /^Wave 1/ });
    fireEvent.click(within(result).getByRole('button', { name: /Continue/ }));
    // The draft: three cards, or skip for cash.
    const draft = screen.getByRole('dialog', { name: 'Pick a tech card' });
    expect(within(draft).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(draft).getByRole('button', { name: /^Skip \(/ }));
    // The next wave's planning.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Deploy wave 2/ })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Forecast' }).textContent).toContain('Wave 2');
  });

  it('offers the mutators before the first deploy of a run with the twists', () => {
    renderRun({ setup: setup({ twists: true }) });
    const picker = screen.getByRole('dialog', { name: "Pick this run's mutator" });
    expect(within(picker).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(picker).getByRole('button', { name: /Play it straight/ }));
    expect(screen.queryByRole('dialog', { name: "Pick this run's mutator" })).toBeNull();
    expect(screen.getByRole('button', { name: /Deploy wave 1/ })).toBeTruthy();
  });

  it('refuses a deploy the rules refuse, and says why', () => {
    // On-call: the root cause comes before the fix.
    renderRun({ setup: setup({ scenario: 'dinnerbell' }) });
    fireEvent.click(screen.getByRole('button', { name: /Deploy wave 1/ }));
    expect(screen.getAllByText(/Name the root cause first/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Deploy wave 1/ })).toBeTruthy();
  });

  it('reports a cleared run, banks it, and shows the final score', async () => {
    const reference = JSON.parse(files['scenarios/shortly/reference.json']) as ScriptedRun;
    const played = playScript(content, 'shortly', reference);
    const log = played.state.log.slice(0, -1);
    expect(played.state.log.at(-1)).toEqual({ t: 'retire' });
    const a = arcade();
    renderRun({ setup: setup({ seed: reference.seed, twists: true, ...(reference.loadout ? { loadout: reference.loadout } : {}) }), resume: log, arcade: a });
    expect(screen.getByRole('heading', { level: 1, name: 'All 12 waves cleared!' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Bank the score/ }));
    });
    expect(a.finish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Bank the score/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Cleared! You scaled it.' })).toBeTruthy();
    expect(screen.getByText(played.state.score.toLocaleString('en-US'))).toBeTruthy();
    expect(screen.getByText('+7')).toBeTruthy();
  });
});
