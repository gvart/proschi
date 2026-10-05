import { describe, expect, it } from 'vitest';
import { GAME_ICONS } from '../engine/icons';
import { GAME_ICON } from './gameIcons';

describe('GAME_ICON', () => {
  it('maps every name in engine/icons.ts to a lucide component, and nothing else', () => {
    expect(Object.keys(GAME_ICON).sort()).toEqual([...GAME_ICONS].sort());
    for (const name of GAME_ICONS) expect(GAME_ICON[name], name).toBeTruthy();
  });

  it('gives each name its own component', () => {
    expect(new Set(Object.values(GAME_ICON)).size).toBe(GAME_ICONS.length);
  });
});
