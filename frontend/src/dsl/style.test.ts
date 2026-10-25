import { describe, expect, it } from 'vitest';
import { tokenizeLine } from './lexer';
import { parse } from './parser';
import { format } from './format';
import { setEdgeLabel } from './edit';

const errors = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

const LEGEND = `legend {
  owned    "Owned by Order Fulfillment" green
  handover "Handed over to POS"         blue
  planned  "Planned flow"               blue dashed
  old      "Deprecated"                 color #ef4444 dotted
}
`;

describe('lexer: tags and hex colors', () => {
  it('reads .tag as a tag token', () => {
    const { tokens } = tokenizeLine('a -> b .planned : label', 1);
    expect(tokens.map((t) => t.kind)).toEqual(['ident', 'arrow', 'ident', 'tag', 'label']);
    expect(tokens[3]).toMatchObject({ value: 'planned', col: 8, length: 8 });
  });

  it('reads #hex as a color only right after color', () => {
    expect(tokenizeLine('a color #3B82F6 # note', 1).tokens.map((t) => [t.kind, t.value])).toEqual([
      ['ident', 'a'],
      ['ident', 'color'],
      ['hex', '#3B82F6'],
    ]);
    expect(tokenizeLine('a color #abc', 1).tokens[2]).toMatchObject({ kind: 'hex', value: '#abc' });
    // Anywhere else a # still starts a comment, even one that looks like a color.
    expect(tokenizeLine('a "A" #add later', 1).tokens).toHaveLength(2);
    expect(tokenizeLine('a color #abcd', 1).tokens).toHaveLength(2);
  });
});

describe('parser: color, tag and critical on nodes', () => {
  it('reads the parts in any order', () => {
    const { diagram, diagnostics } = parse(`${LEGEND}api "API" [Go] critical .owned color teal @team x2\ndb [PostgreSQL] color #ABC .planned`);
    expect(diagnostics).toEqual([]);
    const [api, db] = diagram.nodes;
    expect(api).toMatchObject({ name: 'API', techStack: 'Go', ownerTeam: 'team', replicas: 2, critical: true, tag: 'owned', color: 'teal' });
    // An explicit color wins over the tag's.
    expect(api.style).toEqual({ color: '#14b8a6' });
    expect(db.style).toEqual({ color: '#aabbcc', dash: 'dashed' });
  });

  it('takes the color and dash of the tag', () => {
    const { diagram } = parse(`${LEGEND}a .old\nb .owned`);
    expect(diagram.nodes[0].style).toEqual({ color: '#ef4444', dash: 'dotted' });
    expect(diagram.nodes[1].style).toEqual({ color: '#22c55e' });
  });

  it('leaves nodes without style untouched', () => {
    const node = parse('a [Go]').diagram.nodes[0];
    expect(node.style).toBeUndefined();
    expect('critical' in node).toBe(false);
  });

  it('reports unknown colors with a suggestion', () => {
    expect(errors('a color tael')[0]).toMatch(/^Unknown color 'tael'\. Did you mean 'teal'\? Use gray, blue/);
    expect(errors('a color')[0]).toMatch(/^Expected a color after color/);
    expect(errors('a color #12')[0]).toMatch(/^Expected a color after color/);
  });

  it('reports unknown tags, wherever the legend is', () => {
    expect(errors('a .ownd\nlegend {\n  owned "Owned" green\n}')).toEqual([
      `Unknown tag '.ownd'; add it to the legend, e.g. legend { ownd "What it means" blue }. Did you mean '.owned'?`,
    ]);
    expect(parse('a .owned\nlegend {\n  owned "Owned" green\n}').diagnostics).toEqual([]);
    const [diag] = parse('api [Go] .nope').diagnostics;
    expect(diag).toMatchObject({ severity: 'error', line: 1, col: 10, length: 5 });
  });

  it('allows one tag per node', () => {
    expect(errors(`${LEGEND}a .owned .planned`)).toEqual(["A node takes one tag; '.owned' is already set"]);
  });
});

describe('parser: groups', () => {
  it('reads color, tag and pos in the header in any order', () => {
    const { diagram, diagnostics } = parse(`${LEGEND}group pos "POS" .handover color purple pos 10,20 {\n  a\n}\ngroup g .planned {\n}`);
    expect(diagnostics).toEqual([]);
    const [pos, , g] = diagram.nodes.filter((n) => n.kind === 'group' || n.id === 'a');
    expect(pos).toMatchObject({ kind: 'group', name: 'POS', tag: 'handover', color: 'purple', position: { x: 10, y: 20 }, style: { color: '#a855f7' } });
    expect(g.style).toEqual({ color: '#3b82f6', dash: 'dashed' });
  });

  it('does not take critical', () => {
    expect(errors('group g critical {\n}')[0]).toBe('Expected { after group header');
  });
});

describe('parser: edge tags', () => {
  it('reads a tag before the label', () => {
    const { diagram, diagnostics } = parse(`${LEGEND}a -> b .planned : sync orders\na -> c .old`);
    expect(diagnostics).toEqual([]);
    expect(diagram.edges[0]).toMatchObject({ label: 'sync orders', tag: 'planned', style: { color: '#3b82f6', dash: 'dashed' } });
    expect(diagram.edges[1]).toMatchObject({ tag: 'old', style: { color: '#ef4444', dash: 'dotted' } });
  });

  it('keeps a tag written after the colon in the label', () => {
    const { diagram, diagnostics } = parse(`${LEGEND}a -> b : sync .planned`);
    expect(diagnostics).toEqual([]);
    expect(diagram.edges[0]).toMatchObject({ label: 'sync .planned' });
    expect(diagram.edges[0].tag).toBeUndefined();
  });

  it('rejects two tags, and tags on use case steps', () => {
    expect(errors(`${LEGEND}a -> b .planned .old`)).toEqual(['A connection takes one tag']);
    expect(errors(`${LEGEND}a -> b\nusecase "U" {\n  a -> b .planned : GET /x\n}`)).toEqual(['Tags style connections in the architecture, not use case steps']);
  });

  it('reports an unknown edge tag', () => {
    expect(errors('a -> b .x : y')[0]).toMatch(/^Unknown tag '\.x'/);
  });
});

describe('parser: legend', () => {
  it('reads entries in order, with an optional label, color and dash', () => {
    const { diagram, diagnostics } = parse('legend {\n  a "A" green\n  b blue dashed\n  c "C" dotted\n  d "D" color #FFF\n  e\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.legend!.map((e) => ({ ...e, loc: undefined }))).toEqual([
      { id: 'a', label: 'A', colorName: 'green', color: '#22c55e' },
      { id: 'b', label: 'b', colorName: 'blue', color: '#3b82f6', dash: 'dashed' },
      { id: 'c', label: 'C', dash: 'dotted' },
      { id: 'd', label: 'D', colorName: '#FFF', color: '#ffffff' },
      { id: 'e', label: 'e' },
    ]);
    expect(parse('legend {\n  a green\n}').blocks).toEqual([{ kind: 'legend', start: 1, end: 3 }]);
  });

  it('is absent without a legend block, and legend still works as an id', () => {
    expect(parse('a').diagram.legend).toBeUndefined();
    expect(parse('legend [Go]').diagram.nodes[0]).toMatchObject({ id: 'legend', techStack: 'Go' });
  });

  it('reports bad entries', () => {
    expect(errors('legend {\n  a "A" grene\n}')[0]).toMatch(/^Unknown color 'grene'\. Did you mean 'green'\?/);
    expect(errors('legend {\n  a "A" [Go]\n}')).toEqual(['Unexpected [Go] in legend entry; expected a color, dashed or dotted']);
    expect(errors('legend {\n  a green\n  a blue\n}')).toEqual(["Duplicate legend entry 'a' (first declared on line 2)"]);
    expect(errors('group g {\n  legend {\n  }\n}')[0]).toBe('legend is only allowed at the top level');
  });
});

describe('format', () => {
  it('keeps tags, colors and critical, and aligns tagged connections', () => {
    const src = `legend {\nowned "Owned" green\n  planned "Planned flow" blue  dashed\n  old "Old" color   #ef4444\n}\napi "API" [Go] color #3b82f6   critical .owned\ngroup g "G"   .planned color teal {\n}\napi -> db .planned : sync\napi -> cache : read\n`;
    expect(format(src)).toBe(
      `legend {\n  owned   "Owned"        green\n  planned "Planned flow" blue dashed\n  old     "Old"          color #ef4444\n}\napi "API" [Go] color #3b82f6 critical .owned\ngroup g "G" .planned color teal {\n}\napi -> db .planned : sync\napi -> cache       : read\n`,
    );
    expect(parse(format(src)).diagnostics).toEqual(parse(src).diagnostics);
  });
});

describe('edit: edge labels keep the tag', () => {
  it('sets and clears the label after the tag', () => {
    const src = 'legend {\n  p blue\n}\na -> b .p : old\n';
    expect(setEdgeLabel(src, 'a->b', 'new')).toBe('legend {\n  p blue\n}\na -> b .p : new\n');
    expect(setEdgeLabel(src, 'a->b', null)).toBe('legend {\n  p blue\n}\na -> b .p\n');
  });
});
