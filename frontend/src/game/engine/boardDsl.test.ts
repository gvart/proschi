import { describe, expect, it } from 'vitest';
import { allUnlocks, playScript, type ScriptedRun } from './check';
import { boardToDsl, dslToBoard } from './boardDsl';
import { readContent } from './content';
import type { Board } from './types';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);
const components = new Map(content.components.map((c) => [c.id, c]));
const unlocked = new Set(allUnlocks(content));

describe('boardToDsl and dslToBoard', () => {
  for (const scenario of content.scenarios) {
    it(`round-trip every board of ${scenario.id}'s reference run`, () => {
      const run = JSON.parse(files[`scenarios/${scenario.id}/reference.json`]) as ScriptedRun;
      const game = playScript(content, scenario.id, run);
      const boards = [scenario.start.board, ...game.state.log.flatMap((a) => (a.t === 'deploy' ? [a.board] : []))];
      expect(boards.length).toBeGreaterThan(5);
      const ctx = { components, scenario };
      for (const board of boards) {
        const text = boardToDsl(board, ctx);
        const back = dslToBoard(text, { ...ctx, previous: board, unlocked });
        expect(back.diagnostics).toEqual([]);
        expect(normal(back.board!)).toEqual(normal(board));
      }
    });
  }

  const shortly = content.scenarios.find((s) => s.id === 'shortly')!;
  const ctx = { components, scenario: shortly, previous: shortly.start.board, unlocked: new Set<string>() };

  it('reads replicas, sizes, shards and wires a player typed', () => {
    const text = boardToDsl(shortly.start.board, ctx).replace('[Database]', '[Database] x2') + 'lb [Load Balancer] x2\nusers -> lb\nlb -> api\ncapacity {\n  db size M shards 2\n}\n';
    const { board, diagnostics } = dslToBoard(text, ctx);
    expect(diagnostics).toEqual([]);
    expect(board!.nodes.find((n) => n.id === 'db')).toMatchObject({ component: 'sql', replicas: 2, tier: 1, shards: 2 });
    expect(board!.nodes.find((n) => n.id === 'lb')).toMatchObject({ component: 'lb', replicas: 2 });
    expect(board!.edges).toContainEqual(['lb', 'api']);
  });

  it('refuses what the game does not allow, with the line', () => {
    const base = boardToDsl(shortly.start.board, ctx);
    const message = (text: string) => dslToBoard(text, ctx).diagnostics.map((d) => d.message).join('\n');
    expect(message(`${base}c [Cache]\n`)).toMatch(/Cache is locked/);
    expect(message(`${base}x [Kafka]\n`)).toMatch(/No component is a Kafka/);
    expect(message(base.replace(/^users .*$/gm, ''))).toMatch(/Users must stay on the board/);
    expect(message(`${base}usecase "U" {\n  users -> api\n}\n`)).toMatch(/Use cases come from the scenario/);
    expect(message(`${base}capacity {\n  db latency 2ms\n}\n`)).toMatch(/Only size and shards/);
    expect(dslToBoard(`${base}api ->\n`, ctx).board).toBeUndefined();
    expect(message(base.replace('[Service]', '[Service]  # handles: nope'))).toMatch(/No use case 'nope'/);
    expect(message(base.replace('[Database]', '[Database]  # handles: redirect'))).toMatch(/Only app servers/);
  });

  it('writes and reads which use cases an app server handles as a comment', () => {
    const keys = Object.keys(shortly.useCases).slice(0, 1);
    const board: Board = { ...shortly.start.board, nodes: shortly.start.board.nodes.map((n) => (n.id === 'api' ? { ...n, handles: keys } : n)) };
    const text = boardToDsl(board, ctx);
    expect(text).toContain(`# handles: ${keys[0]}`);
    expect(dslToBoard(text, ctx).board!.nodes.find((n) => n.id === 'api')!.handles).toEqual(keys);
    // Without the comment it serves everything again.
    expect(dslToBoard(text.replace(/ +# handles:.*$/m, ''), ctx).board!.nodes.find((n) => n.id === 'api')!.handles).toBeUndefined();
  });
});

/** Order-free form: the text keeps the order of lines, the game does not care. */
function normal(board: Board) {
  return {
    nodes: [...board.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...board.edges].map((e) => e.join('>')).sort(),
  };
}
