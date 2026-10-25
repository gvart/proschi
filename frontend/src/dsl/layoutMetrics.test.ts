import { describe, expect, it } from 'vitest';
import { parse } from './index';
import { ecommerceExample, eventDrivenExample, urlShortenerExample } from './examples';
import { layoutBoxes } from './autoLayout';
import { bezierPolyline, computeMetrics, formatMetrics, toRects, type LayoutMetrics } from './layoutMetrics';
import orderFulfillment from './layoutFixtures/order-fulfillment.proschi?raw';

/** The layout benchmark: `npm run layout:metrics` prints the table. */
const FIXTURES: Record<string, string> = {
  'order-fulfillment': orderFulfillment,
  ecommerce: ecommerceExample,
  events: eventDrivenExample,
  'url-shortener': urlShortenerExample,
};

async function measure(source: string): Promise<LayoutMetrics> {
  const { diagram, diagnostics } = parse(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const boxes = await layoutBoxes(diagram);
  const rects = toRects(boxes, diagram);
  const byId = new Map(rects.map((r) => [r.id, r]));
  const lines = diagram.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .map((e) => bezierPolyline(e.id, byId.get(e.source)!, byId.get(e.target)!));
  return computeMetrics(rects, lines);
}

describe('layout metrics', () => {
  it('measures every benchmark diagram', async () => {
    const rows: Record<string, LayoutMetrics> = {};
    for (const [name, source] of Object.entries(FIXTURES)) rows[name] = await measure(source);
    if (process.env.LAYOUT_METRICS) console.log(`\n${formatMetrics(rows)}\n`);
    for (const m of Object.values(rows)) expect(m.overlaps).toBe(0);
  }, 30_000);
});
