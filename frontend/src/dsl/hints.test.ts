import { describe, expect, it } from 'vitest';
import { parse } from './index';
import { format } from './format';
import { setNodePosition, uniqueId } from './edit';

const errors = (source: string) => parse(source).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const warnings = (source: string) => parse(source).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);

describe('parser: layout hints', () => {
  it('reads direction and layout ordered at the top level', () => {
    const { diagram, diagnostics } = parse('direction right\nlayout ordered\na\nb\na -> b');
    expect(diagnostics).toEqual([]);
    expect(diagram.layout).toEqual({ direction: 'right', ordered: true });
  });

  it('leaves layout out when no hint is used', () => {
    expect('layout' in parse('a\nb\na -> b').diagram).toBe(false);
  });

  it('reads direction inside a group', () => {
    const { diagram, diagnostics } = parse('group g "G" {\n  direction left\n  a\n}\nb');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.find((n) => n.id === 'g')?.direction).toBe('left');
    expect(diagram.layout).toBeUndefined();
  });

  it('reads rank on nodes and group headers, among the other parts in any order', () => {
    const { diagram, diagnostics } = parse('a "A" rank 0 [Go] @team\nb rank first critical\nc color teal rank last x2\ngroup g "G" rank 2 color blue {\n  d rank 1\n}');
    expect(diagnostics).toEqual([]);
    const rank = (id: string) => diagram.nodes.find((n) => n.id === id)?.rank;
    expect([rank('a'), rank('b'), rank('c'), rank('g'), rank('d')]).toEqual([0, 'first', 'last', 2, 1]);
    expect(diagram.nodes.find((n) => n.id === 'a')).toMatchObject({ name: 'A', techStack: 'Go', ownerTeam: 'team' });
    expect(diagram.nodes.find((n) => n.id === 'c')).toMatchObject({ color: 'teal', replicas: 2 });
  });

  it('still lets nodes be called direction, layout and rank', () => {
    const { diagram, diagnostics } = parse('direction "Direction service" [Go]\nlayout x2\nrank\ndirection -> layout');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['direction', 'layout', 'rank']);
    expect(diagram.layout).toBeUndefined();
  });

  it('rejects bad hints with a clear message', () => {
    expect(errors('direction sideways')).toEqual(["Unknown direction 'sideways'; use direction down, right, up or left"]);
    expect(errors('layout tidy')).toEqual(["Unknown layout mode 'tidy'; the only one is layout ordered"]);
    expect(errors('a rank')).toEqual(['Expected a layer number from 0 (rank 0, rank 1, …), rank first or rank last after rank']);
    expect(errors('a rank top')).toEqual(['Expected a layer number from 0 (rank 0, rank 1, …), rank first or rank last after rank']);
    expect(errors('a rank -1')).toEqual(["'-1' is not a layer number; use a layer number from 0 (rank 0, rank 1, …), rank first or rank last"]);
    expect(errors('a rank 1.5')).toEqual(["'1.5' is not a layer number; use a layer number from 0 (rank 0, rank 1, …), rank first or rank last"]);
    expect(errors('a rank 1 rank 2')).toEqual(['A node takes one rank; rank 1 is already set']);
    // Like any broken group header, the group is not opened, so its } is unmatched.
    expect(errors('group g rank {\n}')).toEqual(['Expected a layer number from 0 (rank 0, rank 1, …), rank first or rank last after rank', 'Unmatched }']);
    expect(errors('group g {\n  layout ordered\n}')).toEqual(['layout ordered applies to the whole diagram; write it at the top level']);
    expect(errors('a\nusecase "U" {\n  direction right\n}')).toEqual(['direction is only allowed at the top level or inside a group']);
  });

  it('warns about a repeated direction and keeps the first', () => {
    const source = 'direction right\ndirection up\ngroup g {\n  direction left\n  direction down\n}';
    expect(warnings(source)).toEqual(['direction is already set on line 1; this one is ignored', "Group 'g' already has direction left; this one is ignored"]);
    const { diagram } = parse(source);
    expect(diagram.layout?.direction).toBe('right');
    expect(diagram.nodes[0].direction).toBe('left');
  });

  it('ignores the top-level hints of an imported file', () => {
    const files: Record<string, string> = { 'infra.proschi': 'direction left\nlayout ordered\ndb [PostgreSQL]' };
    const { diagram, diagnostics } = parse('import "infra.proschi"\napi', { path: 'main.proschi', resolve: (p) => ({ path: p, source: files[p] }) });
    expect(diagnostics).toEqual([]);
    expect(diagram.layout).toBeUndefined();
  });
});

describe('format and edits: layout hints', () => {
  it('keeps hints as statements, not aligned like nodes', () => {
    const source = 'direction   right\nlayout  ordered\napi "API" [Go]   rank 0\ndb   [PostgreSQL] rank   last\n\ngroup g "G"   rank 1 {\ndirection left\n  x\n}\n';
    const formatted = format(source);
    expect(formatted).toBe('direction right\nlayout ordered\napi "API" [Go]         rank 0\ndb        [PostgreSQL] rank last\n\ngroup g "G" rank 1 {\n  direction left\n  x\n}\n');
    expect(format(formatted)).toBe(formatted);
    const strip = (s: string) => JSON.stringify(parse(s).diagram, (k, v) => (k === 'loc' || k === 'col' ? undefined : v));
    expect(strip(formatted)).toEqual(strip(source));
  });

  it('pins a ranked node without losing its rank', () => {
    const next = setNodePosition('api [Go] rank 1\n', 'api', { x: 10, y: 20 });
    expect(next).toBe('api [Go] rank 1 pos 10,20\n');
    expect(parse(next).diagram.nodes[0]).toMatchObject({ rank: 1, position: { x: 10, y: 20 } });
  });

  it('never picks a hint keyword as a new id', () => {
    expect(uniqueId('', 'direction')).not.toBe('direction');
    expect(uniqueId('', 'layout')).not.toBe('layout');
    expect(uniqueId('', 'rank')).not.toBe('rank');
  });
});
