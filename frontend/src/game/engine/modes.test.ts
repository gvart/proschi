import { describe, expect, it } from 'vitest';
import { checkGame } from './check';
import { readContent } from './content';
import { MECHANICS, MODES, ownerOf } from './modes';
import { Game } from './run';
import { allUnlocks } from './check';
import { GAME_MODES } from './types';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);
const ctx = { cards: new Set<string>(), topics: new Set<string>(), problems: new Set<string>() };

describe('modes', () => {
  it('has rules for every mode, and only Scale or Fail drafts and plays the twists', () => {
    expect(Object.keys(MODES).sort()).toEqual([...GAME_MODES].sort());
    for (const m of Object.values(MODES)) {
      expect(m.draft).toBe(m.id === 'scale');
      expect(m.twists).toBe(m.id === 'scale');
    }
  });

  it('gives each mechanic action one owner', () => {
    expect(ownerOf('migrate')).toBe(MECHANICS.find((m) => m.id === 'migrations')!.actions!.migrate);
    expect(ownerOf('sunset')).toBe(MECHANICS.find((m) => m.id === 'legacy-versions')!.actions!.sunset);
    expect(ownerOf('diagnose')).toBe(MECHANICS.find((m) => m.id === 'diagnosis')!.actions!.diagnose);
    expect(ownerOf('deploy')).toBeUndefined();
  });

  it('runs each scenario with its mode', () => {
    for (const s of content.scenarios) {
      const game = new Game(content, { scenario: s.id, seed: 'm', ascension: 0, mode: 'normal', loadout: { unlocked: allUnlocks(content), perks: {} } });
      expect(game.mode).toBe(MODES[s.mode]);
    }
  });

  it('refuses a mechanic in a mode that does not play it', () => {
    const md = files['scenarios/dinnerbell/scenario.md'];
    expect(md).toMatch(/^mode: incident$/m);
    const broken = { ...files, 'scenarios/dinnerbell/scenario.md': md.replace(/^mode: incident$/m, 'mode: cost') };
    const messages = checkGame(broken, ctx).violations.map((v) => v.message);
    expect(messages.some((m) => m.startsWith('Diagnoses: the cost mode does not play them'))).toBe(true);
  }, 60_000);
});
