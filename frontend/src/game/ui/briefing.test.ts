import { describe, expect, it } from 'vitest';
import { playScript, type ScriptedRun } from '../engine/check';
import { readContent } from '../engine/content';
import { briefing, sayRequirement } from './briefing';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);
const reference = (id: string) => JSON.parse(files[`scenarios/${id}/reference.json`]) as ScriptedRun;

/** Shortly's reference run, stopped at the plan of `wave` (0-based). */
const at = (wave: number) => {
  const game = playScript(content, 'shortly', reference('shortly'), wave);
  expect(game.state.wave).toBe(wave);
  return { game, forecast: game.forecast(), said: briefing(game.scenario, game.waveDef(), game.forecast()) };
};

describe("Kernel's briefing", () => {
  it('says requirements in plain words', () => {
    expect(sayRequirement('p99 "Redirect" < 200ms')).toBe('Redirect must answer in under 200 ms for 99% of requests.');
    expect(sayRequirement('availability "Redirect" >= 99.5%')).toBe('Redirect must stay up 99.5% of the time.');
    expect(sayRequirement('cost <= 1200 usd/month')).toBe('The cloud bill has to stay under $1,200 a month.');
    expect(sayRequirement('survive any node failure')).toMatch(/two of everything/);
    expect(sayRequirement('durable "Checkout"')).toMatch(/Checkout must never lose a request/);
    expect(sayRequirement('something new')).toBe('New rule: something new.');
  });

  it('welcomes you on the first wave with the starting rules', () => {
    const { forecast, said } = at(0);
    expect(forecast.news.useCases).toEqual(['redirect', 'shorten']);
    expect(forecast.news.growth).toBeUndefined();
    expect(said.mood).toBe('happy');
    expect(said.lines[0]).toMatch(/^Welcome aboard! A URL shortener goes viral/);
    expect(said.lines).toContain('Redirect must answer in under 200 ms for 99% of requests.');
  });

  it('tells only what is new on a later wave, with the traffic against last month', () => {
    const { forecast, said } = at(2);
    expect(forecast.news.requirements).toEqual(['availability "Redirect" >= 99.5%']);
    expect(forecast.news.growth).toBeGreaterThan(1);
    expect(said.lines.some((l) => /^Traffic is up \d+% on last month/.test(l))).toBe(true);
    expect(said.lines).toContain('Redirect must stay up 99.5% of the time.');
    expect(said.lines).not.toContain('Redirect must answer in under 200 ms for 99% of requests.');
  });

  it("opens a boss wave with the scenario's own intro, alarmed", () => {
    const { forecast, said } = at(3);
    expect(forecast.boss).toBe(true);
    expect(said.mood).toBe('alarmed');
    expect(said.lines[0]).toMatch(/Product Hunt/);
  });

  it('applies the ascension to the requirements it reads out', () => {
    const run = { ...reference('shortly'), ascension: 4 };
    const game = playScript(content, 'shortly', run, 0);
    const line = game.forecast().news.requirements.find((l) => l.startsWith('p99'));
    expect(line).toBeDefined();
    expect(game.state.requirements).toContain(line);
  });
});
