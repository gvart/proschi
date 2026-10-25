import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from './index';
import { ecommerceExample, eventDrivenExample, urlShortenerExample } from './examples';
import { layoutGraph, simplify } from './autoLayout';
import { fallbackRoute } from './edgePath';
import { computeMetrics, formatMetrics, toRects, type LayoutMetrics, type Polyline, type Rect } from './layoutMetrics';
import orderFulfillment from './layoutFixtures/order-fulfillment.proschi?raw';
import orderFulfillmentHinted from './layoutFixtures/order-fulfillment-hinted.proschi?raw';

/** The layout benchmark: `npm run layout:metrics` prints the table. */
const FIXTURES: Record<string, string> = {
  'order-fulfillment': orderFulfillment,
  'order-fulfillment-hinted': orderFulfillmentHinted,
  ecommerce: ecommerceExample,
  events: eventDrivenExample,
  'url-shortener': urlShortenerExample,
};

/** A bare drawing of the measured geometry, for eyeballing engine settings (`LAYOUT_METRICS_SVG=<dir>`). */
function sketch(rects: Rect[], lines: Polyline[]): string {
  const xs = [...rects.flatMap((r) => [r.x, r.x + r.width]), ...lines.flatMap((l) => l.points.map((p) => p.x))];
  const ys = [...rects.flatMap((r) => [r.y, r.y + r.height]), ...lines.flatMap((l) => l.points.map((p) => p.y))];
  const minX = Math.min(...xs) - 20;
  const minY = Math.min(...ys) - 20;
  const w = Math.max(...xs) - minX + 20;
  const h = Math.max(...ys) - minY + 20;
  const body = [
    ...rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.group ? 'none' : '#fff'}" stroke="#333" ${r.group ? 'stroke-dasharray="6 4"' : ''}/><text x="${r.x + 6}" y="${r.y + 16}" font-size="13">${r.id}</text>`),
    ...lines.map((l) => `<polyline points="${l.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#c03" stroke-width="1.5"/>`),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#f8f4ea"/>${body.join('')}</svg>`;
}

async function measure(source: string, name = ''): Promise<LayoutMetrics> {
  const { diagram, diagnostics } = parse(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const { nodes, routes } = await layoutGraph(diagram, undefined, process.env.LAYOUT_ELK ? { elk: JSON.parse(process.env.LAYOUT_ELK) } : {});
  const rects = toRects(nodes, diagram);
  const byId = new Map(rects.map((r) => [r.id, r]));
  const lines = diagram.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .map((e) => {
      const route = routes[e.id];
      if (!route) {
        // What the canvas draws without a route.
        const points = fallbackRoute(byId.get(e.source)!, byId.get(e.target)!);
        return { id: e.id, source: e.source, target: e.target, points, bends: points.length - 2 };
      }
      const points = simplify(route.points);
      return { id: e.id, source: e.source, target: e.target, points, bends: points.length - 2, routed: true };
    });
  if (process.env.LAYOUT_METRICS_SVG) writeFileSync(join(process.env.LAYOUT_METRICS_SVG, `${name}.svg`), sketch(rects, lines));
  return computeMetrics(rects, lines);
}

describe('layout metrics', () => {
  it('measures every benchmark diagram', async () => {
    const rows: Record<string, LayoutMetrics> = {};
    for (const [name, source] of Object.entries(FIXTURES)) rows[name] = await measure(source, name);
    if (process.env.LAYOUT_METRICS) console.log(`\n${formatMetrics(rows)}\n`);
    for (const [name, m] of Object.entries(rows)) {
      expect({ name, overlaps: m.overlaps, throughNodes: m.throughNodes, unrouted: m.unrouted, cornerEnds: m.cornerEnds }).toEqual({ name, overlaps: 0, throughNodes: 0, unrouted: 0, cornerEnds: 0 });
    }
    // Before routed edges (React Flow beziers on ELK's placement): 116 crossings, 29 edges through nodes.
    expect(rows['order-fulfillment'].crossings).toBeLessThanOrEqual(22);
    expect(rows['order-fulfillment'].maxLength).toBeLessThanOrEqual(4500);
    expect(rows['order-fulfillment'].aspect).toBeGreaterThan(0.6);
    expect(rows['order-fulfillment'].aspect).toBeLessThan(2);
    for (const name of ['ecommerce', 'events', 'url-shortener']) expect(rows[name].crossings).toBe(0);
    // With hints (layoutFixtures/README.md): fewer crossings than without, in the reference's shape.
    expect(rows['order-fulfillment-hinted'].crossings).toBeLessThanOrEqual(11);
    expect(rows['order-fulfillment-hinted'].totalLength).toBeLessThanOrEqual(64_000);
    expect(rows['order-fulfillment-hinted'].maxLength).toBeLessThanOrEqual(4500);
  }, 30_000);

  it('steers the hinted fixture into the shape of the reference', async () => {
    const { diagram } = parse(orderFulfillmentHinted);
    const rects = new Map(toRects((await layoutGraph(diagram)).nodes, diagram).map((r) => [r.id, r]));
    const top = (id: string) => rects.get(id)!.y;
    const bottom = (id: string) => rects.get(id)!.y + rects.get(id)!.height;
    // The third-party systems ranked 0 form the top row, above AWS region 1.
    const row = diagram.nodes.filter((n) => n.rank === 0).map((n) => top(n.id));
    expect(row.length).toBe(11);
    expect(new Set(row).size).toBe(1);
    expect(row[0]).toBe(Math.min(...[...rects.values()].map((r) => r.y)));
    // Then region 1, region 2, Kafka and GCP, one below the other.
    expect(bottom('awsCore')).toBeLessThan(top('awsMgmt'));
    expect(bottom('awsMgmt')).toBeLessThan(top('kafka'));
    expect(bottom('kafka')).toBeLessThan(top('gcp'));
    // Kafka laid out to the right: its topics in one row.
    const topics = diagram.nodes.filter((n) => n.parent === 'kafka').map((n) => rects.get(n.id)!);
    expect(new Set(topics.map((t) => t.y)).size).toBe(1);
  }, 30_000);
});
