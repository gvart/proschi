import { describe, expect, it } from 'vitest';
import { ecommerceExample, parse } from './index';
import { layoutDiagram, provisionalLayout } from './layout';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layoutDiagram', () => {
  it('places members inside their group without overlaps', async () => {
    const nodes = await layoutDiagram(parse(ecommerceExample).diagram);
    const group = nodes.find((n) => n.id === 'vpc')!;
    const members = nodes.filter((n) => n.parentNode === 'vpc');

    expect(members.map((n) => n.id)).toEqual(['gateway', 'orders', 'users']);
    expect(group.style?.width).toBeGreaterThan(0);
    for (const m of members) {
      expect(m.position.x).toBeGreaterThanOrEqual(0);
      expect(m.position.y).toBeGreaterThanOrEqual(56);
      expect(m.position.x + Number(m.style?.width)).toBeLessThanOrEqual(Number(group.style?.width));
    }

    const topLevel = nodes.filter((n) => !n.parentNode);
    const boxes = topLevel.map((n) => ({ x: n.position.x, y: n.position.y, w: Number(n.style?.width ?? 240), h: Number(n.style?.height ?? 84) }));
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });

  it('keeps explicit positions', async () => {
    const nodes = await layoutDiagram(parse('a pos 500,40\nb\na -> b').diagram);
    expect(nodes[0].position).toEqual({ x: 500, y: 40 });
  });

  it('lays out flows that only exist in use cases', async () => {
    const nodes = await layoutDiagram(parse('usecase U {\n  a -> b\n  b -> c\n}').diagram);
    const y = Object.fromEntries(nodes.map((n) => [n.id, n.position.y]));
    expect(y.a).toBeLessThan(y.b);
    expect(y.b).toBeLessThan(y.c);
  });

  it('ignores edges between a group and its members', async () => {
    const nodes = await layoutDiagram(parse('group g {\n  a\n}\ng -> a').diagram);
    expect(nodes.map((n) => n.id)).toEqual(['g', 'a']);
  });
});

describe('pinned group members', () => {
  it('grows the group to contain a member dragged outside it', async () => {
    const nodes = await layoutDiagram(parse('group g {\n  a\n  b pos 900,700\n}').diagram);
    const group = nodes.find((n) => n.id === 'g')!;
    expect(Number(group.style?.width)).toBeGreaterThanOrEqual(900 + 240);
    expect(Number(group.style?.height)).toBeGreaterThanOrEqual(700 + 84);
  });
});

describe('provisionalLayout', () => {
  it('places every node at once, members inside their group, without overlaps', () => {
    const diagram = parse(ecommerceExample).diagram;
    const nodes = provisionalLayout(diagram);
    expect(nodes.map((n) => n.id)).toEqual(diagram.nodes.map((n) => n.id));
    const group = nodes.find((n) => n.id === 'vpc')!;
    for (const m of nodes.filter((n) => n.parentNode === 'vpc')) {
      expect(m.position.y).toBeGreaterThanOrEqual(56);
      expect(m.position.x + Number(m.style?.width)).toBeLessThanOrEqual(Number(group.style?.width));
    }
    for (const parent of [undefined, 'vpc']) {
      const boxes = nodes
        .filter((n) => n.parentNode === parent)
        .map((n) => ({ x: n.position.x, y: n.position.y, w: Number(n.style?.width), h: Number(n.style?.height ?? 110) }));
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    }
  });

  it('keeps explicit positions and grows groups around them', () => {
    const nodes = provisionalLayout(parse('group g {\n  a\n  b pos 900,700\n}\nc pos 5,6').diagram);
    expect(nodes.find((n) => n.id === 'c')!.position).toEqual({ x: 5, y: 6 });
    const group = nodes.find((n) => n.id === 'g')!;
    expect(Number(group.style?.width)).toBeGreaterThanOrEqual(900 + 240);
    expect(Number(group.style?.height)).toBeGreaterThanOrEqual(700 + 84);
  });
});
