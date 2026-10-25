import { describe, expect, it } from 'vitest';
import { ecommerceExample, parse } from './index';
import { layoutDiagram, provisionalLayout } from './layout';
import { layoutGraph } from './autoLayout';

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

describe('group size', () => {
  it('keeps a small group at the minimum size, not taller', async () => {
    const { nodes } = await layoutGraph(parse('a\ngroup g {\n  b\n}\na -> b').diagram);
    const g = nodes.find((n) => n.id === 'g')!;
    expect([g.width, g.height]).toEqual([300, 200]);
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

describe('edge routes', () => {
  type Abs = { x: number; y: number; w: number; h: number };
  const onBorder = (p: { x: number; y: number }, b: Abs) =>
    ((Math.abs(p.y - b.y) < 1 || Math.abs(p.y - (b.y + b.h)) < 1) && p.x >= b.x - 1 && p.x <= b.x + b.w + 1) ||
    ((Math.abs(p.x - b.x) < 1 || Math.abs(p.x - (b.x + b.w)) < 1) && p.y >= b.y - 1 && p.y <= b.y + b.h + 1);

  it("routes every edge orthogonally from border to border, at the cards' drawn size", async () => {
    const diagram = parse(ecommerceExample).diagram;
    const { nodes, routes } = await layoutGraph(diagram);
    const abs = (id: string): Abs => {
      const b = nodes.find((n) => n.id === id)!;
      const p = b.parent ? abs(b.parent) : { x: 0, y: 0 };
      return { x: p.x + b.position.x, y: p.y + b.position.y, w: b.width, h: b.height };
    };
    for (const n of nodes.filter((n) => diagram.nodes.find((d) => d.id === n.id)!.kind === 'component')) {
      expect([n.width, n.height]).toEqual([240, 84]);
    }
    for (const edge of diagram.edges) {
      const route = routes[edge.id];
      expect(route, edge.id).toBeDefined();
      route.points.slice(1).forEach((p, i) => {
        const q = route.points[i];
        expect(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01).toBe(true);
      });
      expect(onBorder(route.points[0], abs(edge.source)), `${edge.id} start`).toBe(true);
      expect(onBorder(route.points[route.points.length - 1], abs(edge.target)), `${edge.id} end`).toBe(true);
      expect(route.from).toEqual({ x: abs(edge.source).x, y: abs(edge.source).y });
    }
  });

  it('breaks a cycle by declaration order, the route still running from source to target', async () => {
    const diagram = parse('a\nb\na -> b\nb -> a : back').diagram;
    const { nodes, routes } = await layoutGraph(diagram);
    const y = Object.fromEntries(nodes.map((n) => [n.id, n.position.y]));
    expect(y.a).toBeLessThan(y.b);
    const back = routes[diagram.edges[1].id].points;
    // b -> a starts at b (below) and ends at a (above).
    expect(back[0].y).toBeGreaterThan(back[back.length - 1].y);
  });

  it('drops the route of an edge whose end is pinned elsewhere', async () => {
    const diagram = parse('a pos 900,40\nb\nc\na -> b\nb -> c').diagram;
    const { routes } = await layoutGraph(diagram);
    expect(routes[diagram.edges[0].id]).toBeUndefined();
    expect(routes[diagram.edges[1].id]).toBeDefined();
  });

  it('hands the routes to the canvas on the source node', async () => {
    const diagram = parse(ecommerceExample).diagram;
    const nodes = await layoutDiagram(diagram);
    const gateway = nodes.find((n) => n.id === 'gateway')!;
    const ids = diagram.edges.filter((e) => e.source === 'gateway').map((e) => e.id);
    expect(Object.keys(gateway.data.routes ?? {}).sort()).toEqual(ids.sort());
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
