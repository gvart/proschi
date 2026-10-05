import { describe, expect, it } from 'vitest';
import { checkGame } from './check';
import { readContent } from './content';
import { GAME_ICONS, isIconName } from './icons';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const cardFiles = import.meta.glob('../../practice/cards/*/*.md', { query: '?raw', import: 'default', eager: true });
const tags = import.meta.glob('../../practice/cards/tags.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const problemFiles = import.meta.glob('../../practice/problems/*/problem.md', { query: '?raw', import: 'default', eager: true });
const ctx = {
  cards: new Set(Object.keys(cardFiles).map((p) => p.replace(/^.*\//, '').replace(/\.md$/, ''))),
  topics: new Set((JSON.parse(Object.values(tags)[0]) as { id: string }[]).map((t) => t.id)),
  problems: new Set(Object.keys(problemFiles).map((p) => p.split('/').slice(-2)[0])),
};
const { content } = readContent(files);

describe('game icons', () => {
  it('lists each name once, in kebab case', () => {
    expect(new Set(GAME_ICONS).size).toBe(GAME_ICONS.length);
    for (const name of GAME_ICONS) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it.each([
    ['perks', content.perks],
    ['cards', content.cards],
    ['events', content.events],
  ] as const)('gives every one of the %s a known icon of its own', (_, items) => {
    expect(items.length).toBeGreaterThan(0);
    const icons = items.map((i) => i.icon);
    expect(icons.filter((i) => !isIconName(i))).toEqual([]);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('reports a missing, unknown or repeated icon', () => {
    const broken = {
      ...files,
      'cards/gzip.md': files['cards/gzip.md'].replace('icon: file-archive', 'icon: cable'),
      'events/ddos.md': files['events/ddos.md'].replace('icon: bot', 'icon: no-such-icon'),
      'perks.json': files['perks.json'].replace('"icon": "heart", ', ''),
    };
    const violations = checkGame(broken, ctx).violations;
    const at = (file: string) => violations.filter((v) => v.file === file).map((v) => v.message);
    expect(at('cards/gzip.md')).toContainEqual(expect.stringContaining("icon 'cable' is already used by the card 'connection-pooling'"));
    expect(at('events/ddos.md')).toContainEqual(expect.stringContaining("unknown icon 'no-such-icon'"));
    expect(at('perks.json')).toContainEqual(expect.stringContaining("'loyal-users' needs an \"icon\""));
  });

  it('lets a category reuse another category’s icon', () => {
    const reused = { ...files, 'cards/gzip.md': files['cards/gzip.md'].replace('icon: file-archive', 'icon: piggy-bank') };
    expect(checkGame(reused, ctx).violations.filter((v) => v.message.includes('icon'))).toEqual([]);
  });
});
