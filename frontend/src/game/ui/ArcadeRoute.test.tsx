// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../practice/useAccount';
import { gameContent } from '../content';
import ArcadeRoute from './ArcadeRoute';
import { MODE_BLURB } from './visual';

vi.mock('./GameCanvas', () => ({ default: () => <div data-testid="board" /> }));
vi.mock('./sound', () => ({ play: () => {}, buzz: () => {}, setSound: () => {} }));
vi.mock('virtual:practice-cards', () => ({ default: { cards: [], topics: [] } }));

const account = { state: { status: 'off' } } as unknown as Account;

afterEach(cleanup);

describe('Arcade home', () => {
  it('lists the Scale or Fail chain and the design challenges apart, each challenge with what its mode asks', () => {
    render(<ArcadeRoute account={account} />);
    const { content } = gameContent();
    const titles = (name: RegExp) =>
      within(screen.getByRole('region', { name }))
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent);
    const chain = content.scenarios.filter((s) => s.mode === 'scale');
    const challenges = content.scenarios.filter((s) => s.mode !== 'scale');
    expect(challenges.map((s) => s.mode).sort()).toEqual(['cost', 'incident', 'legacy', 'startup']);
    expect(titles(/^Scale or Fail scenarios$/)).toEqual(chain.map((s) => s.title));
    expect(titles(/^Design challenges$/)).toEqual(challenges.map((s) => s.title));
    const section = screen.getByRole('region', { name: /^Design challenges$/ });
    for (const s of challenges) expect(within(section).getByText(MODE_BLURB[s.mode])).toBeTruthy();
  });
});
