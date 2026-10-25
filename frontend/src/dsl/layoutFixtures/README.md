# Layout benchmark

`order-fulfillment.proschi` is a 50-node HLD rebuilt from a hand-drawn
reference diagram. It is a test fixture, not a showcase. Together with three
of the built-in examples it is measured by `layoutMetrics.test.ts`, which
checks thresholds on every test run. `npm run layout:metrics` prints the
table, and `LAYOUT_METRICS_SVG=<dir>` also writes a bare sketch of each
layout to that directory.

Columns: `unrouted` counts edges the layout gave no route (they use the
fallback), `crossings` counts edge segments that cross, the lengths are in
px, `bends` counts the turns of all edges, `overlaps` counts boxes that
overlap where neither contains the other, `throughNodes` counts edges that
cross a node that isn't one of their ends, and `aspect` is width over height.

Before: ELK layered positions, edges drawn as React Flow beziers from the
bottom handle to the top handle (the beziers were sampled; an S-curve
counts as two bends).

| fixture | nodes | edges | crossings | totalLength | maxLength | bends | overlaps | throughNodes | width | height | aspect |
|---|---|---|---|---|---|---|---|---|---|---|---|
| order-fulfillment | 50 | 57 | 116 | 81231 | 3919 | 108 | 0 | 29 | 4721 | 3174 | 1.49 |
| ecommerce | 7 | 6 | 0 | 1433 | 373 | 10 | 0 | 1 | 816 | 613 | 1.33 |
| events | 6 | 5 | 0 | 1224 | 527 | 10 | 0 | 0 | 816 | 456 | 1.79 |
| url-shortener | 5 | 4 | 0 | 495 | 266 | 4 | 0 | 0 | 528 | 612 | 0.86 |

After: orthogonal ELK routes, cycles broken by declaration order, model
order, network-simplex placement, inline labels, cards at their drawn height.

| fixture | nodes | edges | unrouted | crossings | totalLength | maxLength | bends | overlaps | throughNodes | width | height | aspect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| order-fulfillment | 50 | 57 | 0 | 17 | 58776 | 4054 | 166 | 0 | 0 | 3952 | 3068 | 1.29 |
| ecommerce | 7 | 6 | 0 | 0 | 1833 | 555 | 8 | 0 | 0 | 800 | 749 | 1.07 |
| events | 6 | 5 | 0 | 0 | 671 | 172 | 4 | 0 | 0 | 680 | 530 | 1.28 |
| url-shortener | 5 | 4 | 0 | 0 | 324 | 146 | 2 | 0 | 0 | 520 | 498 | 1.04 |

Orthogonal routes are longer than beziers between the same points, so total
length on the small examples is not directly comparable. The ecommerce
example is also taller because ELK now leaves room for each label.
