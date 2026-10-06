import { describe, expect, it } from 'vitest';
import { readContent } from '../engine/content';
import { cloneBoard } from '../engine/board';
import { TUTORIAL_SCENARIO, TUTORIAL_STEPS, TUTORIAL_TEXT, tutorialStep, twistsIntro } from './tutorial';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);
const components = new Map(content.components.map((c) => [c.id, c]));
const start = content.scenarios.find((s) => s.id === TUTORIAL_SCENARIO)!.start.board;

describe("Kernel's first-wave tutorial", () => {
  it('reads each step off the plan: a load balancer, a second app server, a load test, then deploy', () => {
    const plan = cloneBoard(start);
    expect(tutorialStep(plan, false, components)).toBe('lb');
    plan.nodes.push({ id: 'lb', component: 'lb', replicas: 1 });
    expect(tutorialStep(plan, false, components)).toBe('replica');
    plan.nodes.find((n) => n.id === 'api')!.replicas = 2;
    expect(tutorialStep(plan, false, components)).toBe('loadtest');
    expect(tutorialStep(plan, true, components)).toBe('deploy');
    // Undo steps back.
    expect(tutorialStep(start, true, components)).toBe('lb');
  });

  it('starts on a board the first run allows, and says something at every step', () => {
    expect(start.nodes.some((n) => n.component === 'lb')).toBe(false);
    expect(components.get('lb')!.unlock).toBe(0);
    for (const step of TUTORIAL_STEPS) expect(TUTORIAL_TEXT[step].length).toBeLessThanOrEqual(240);
  });

  it('introduces the twists once, for a first clear or a daily run', () => {
    const intro = twistsIntro(false);
    expect(intro.lines[0]).toMatch(/cleared your first run/);
    expect(intro.lines.join(' ')).toMatch(/Mutators.*Bounties.*ranges.*Hold the line.*unannounced.*set/);
    expect(twistsIntro(true).lines[0]).toMatch(/daily run/);
  });
});
