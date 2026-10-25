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

  it("steps around a group's name instead of striking it through", async () => {
    const diagram = parse('a\ngroup g "Order Fulfillment" {\n  b\n}\na -> b').diagram;
    const { nodes, routes } = await layoutGraph(diagram);
    const g = nodes.find((n) => n.id === 'g')!;
    const name = { x0: g.position.x + 8, x1: g.position.x + 40 + 'Order Fulfillment'.length * 11, y0: g.position.y, y1: g.position.y + 36 };
    const points = routes[diagram.edges[0].id].points;
    expect(points.length).toBeGreaterThan(2);
    points.slice(1).forEach((q, i) => {
      const p = points[i];
      const vertical = Math.abs(p.x - q.x) < 0.5;
      const through = vertical && p.x > name.x0 && p.x < name.x1 && Math.min(p.y, q.y) < name.y1 && Math.max(p.y, q.y) > name.y0;
      expect(through, JSON.stringify([p, q])).toBe(false);
    });
    // It still ends on b's top, pointing down.
    const [before, end] = points.slice(-2);
    expect(before.x).toBe(end.x);
    expect(end.y - before.y).toBeGreaterThanOrEqual(10);
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

describe('layout hints', () => {
  type Abs = { x: number; y: number; w: number; h: number };
  const laidOut = async (source: string) => {
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const layout = await layoutGraph(diagram);
    const abs = (id: string): Abs => {
      const b = layout.nodes.find((n) => n.id === id)!;
      const p = b.parent ? abs(b.parent) : { x: 0, y: 0 };
      return { x: p.x + b.position.x, y: p.y + b.position.y, w: b.width, h: b.height };
    };
    return { diagram, ...layout, abs };
  };
  const onBorder = (p: { x: number; y: number }, b: Abs) =>
    ((Math.abs(p.y - b.y) < 1 || Math.abs(p.y - (b.y + b.h)) < 1) && p.x >= b.x - 1 && p.x <= b.x + b.w + 1) ||
    ((Math.abs(p.x - b.x) < 1 || Math.abs(p.x - (b.x + b.w)) < 1) && p.y >= b.y - 1 && p.y <= b.y + b.h + 1);

  it('lines up nodes of the same rank, lower ranks higher', async () => {
    const { abs } = await laidOut('a rank 0\nb\nc rank 1\nd rank 1\ne\na -> b\nb -> c\nd -> e');
    expect(abs('c').y).toBe(abs('d').y);
    expect(abs('a').y).toBeLessThan(abs('b').y);
    expect(abs('b').y).toBeLessThan(abs('c').y);
    expect(abs('e').y).toBeGreaterThan(abs('d').y);
  });

  it('keeps a rank against the direction of an edge, the route still running from source to target', async () => {
    const { diagram, routes, abs } = await laidOut('a rank 1\nb rank 0\na -> b');
    expect(abs('b').y).toBeLessThan(abs('a').y);
    const points = routes[diagram.edges[0].id].points;
    expect(onBorder(points[0], abs('a'))).toBe(true);
    expect(onBorder(points[points.length - 1], abs('b'))).toBe(true);
  });

  it('puts the target of an edge between two nodes of one rank a layer lower, its label on the route', async () => {
    const { diagram, routes, abs } = await laidOut('a rank 0\nb rank 0\nc rank 0\nd rank 1\na -> b : calls\nc -> d : a long label here');
    expect(abs('a').y).toBe(abs('c').y);
    expect(abs('b').y).toBeGreaterThan(abs('a').y + abs('a').h);
    expect(abs('d').y).toBeGreaterThan(abs('b').y);
    for (const edge of diagram.edges) {
      const { points, label } = routes[edge.id];
      expect(onBorder(points[0], abs(edge.source))).toBe(true);
      expect(onBorder(points[points.length - 1], abs(edge.target))).toBe(true);
      // The label sits on the line, between the two nodes.
      expect(label).toBeDefined();
      const on = points.slice(1).some((q, i) => {
        const p = points[i];
        return Math.min(p.x, q.x) - 0.5 <= label!.x && label!.x <= Math.max(p.x, q.x) + 0.5 && Math.min(p.y, q.y) - 0.5 <= label!.y && label!.y <= Math.max(p.y, q.y) + 0.5;
      });
      expect(on, edge.id).toBe(true);
    }
  });

  it('puts rank first above and rank last below everything', async () => {
    const { abs } = await laidOut('a\nb\nc\nlogs rank first\nusers rank last\na -> b\nb -> c\nc -> logs\nusers -> a');
    for (const id of ['a', 'b', 'c']) {
      expect(abs('logs').y).toBeLessThan(abs(id).y);
      expect(abs('users').y).toBeGreaterThan(abs(id).y);
    }
  });

  it('ranks groups among top-level nodes, and members within their group', async () => {
    const { abs } = await laidOut('x\ngroup g "G" rank 0 {\n  a\n  b rank 0\n  c rank 0\n  a -> b\n}\ny rank 0\nx -> a');
    // One layer: y sits within g's height; x, unranked, goes where its edge pulls it, above them.
    expect(abs('y').y).toBeGreaterThanOrEqual(abs('g').y);
    expect(abs('y').y + abs('y').h).toBeLessThanOrEqual(abs('g').y + abs('g').h);
    expect(abs('x').y + abs('x').h).toBeLessThan(abs('g').y);
    expect(abs('b').y).toBe(abs('c').y);
    expect(abs('a').y).toBeLessThan(abs('b').y);
  });

  it('turns the whole diagram with a top-level direction', async () => {
    const right = await laidOut('direction right\na\nb\na -> b');
    expect(right.abs('b').x).toBeGreaterThan(right.abs('a').x + right.abs('a').w);
    expect(right.abs('b').y).toBe(right.abs('a').y);
    const up = await laidOut('direction up\na\nb\na -> b');
    expect(up.abs('b').y + up.abs('b').h).toBeLessThan(up.abs('a').y);
  });

  it('lays out a group in its own direction, with routes into it ending on the member', async () => {
    const { diagram, routes, abs } = await laidOut('x\ngroup g "Kafka" {\n  direction right\n  a\n  b\n  c\n  a -> b\n  b -> c\n}\nz\nx -> b\nc -> z');
    expect(abs('a').y).toBe(abs('b').y);
    expect(abs('b').x).toBeGreaterThan(abs('a').x + abs('a').w);
    expect(abs('c').x).toBeGreaterThan(abs('b').x + abs('b').w);
    expect(abs('x').y).toBeLessThan(abs('g').y);
    expect(abs('z').y).toBeGreaterThan(abs('g').y + abs('g').h);
    const g = abs('g');
    for (const id of ['a', 'b', 'c']) {
      const m = abs(id);
      expect(m.x).toBeGreaterThanOrEqual(g.x + 24);
      expect(m.y).toBeGreaterThanOrEqual(g.y + 56);
      expect(m.x + m.w).toBeLessThanOrEqual(g.x + g.w);
    }
    for (const edge of diagram.edges) {
      const route = routes[edge.id];
      expect(route, edge.id).toBeDefined();
      route.points.slice(1).forEach((p, i) => {
        const q = route.points[i];
        expect(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01, `${edge.id} orthogonal`).toBe(true);
      });
      expect(onBorder(route.points[0], abs(edge.source)), `${edge.id} start`).toBe(true);
      expect(onBorder(route.points[route.points.length - 1], abs(edge.target)), `${edge.id} end`).toBe(true);
      expect(route.from).toEqual({ x: abs(edge.source).x, y: abs(edge.source).y });
      expect(route.to).toEqual({ x: abs(edge.target).x, y: abs(edge.target).y });
    }
  });

  it('lays every edge out by declaration order with layout ordered, and only then', async () => {
    const plain = await laidOut('b\na\na -> b');
    expect(plain.abs('a').y).toBeLessThan(plain.abs('b').y);
    const ordered = await laidOut('layout ordered\nb\na\na -> b');
    expect(ordered.abs('b').y).toBeLessThan(ordered.abs('a').y);
    const points = ordered.routes[ordered.diagram.edges[0].id].points;
    expect(onBorder(points[0], ordered.abs('a'))).toBe(true);
  });
});
