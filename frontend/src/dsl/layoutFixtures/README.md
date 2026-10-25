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
cross a node that isn't one of their ends, `cornerEnds` counts edge ends
within 8 px of a corner of their node, and `aspect` is width over height.

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

| fixture | nodes | edges | unrouted | crossings | totalLength | maxLength | bends | overlaps | throughNodes | cornerEnds | width | height | aspect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| order-fulfillment | 50 | 57 | 0 | 17 | 58908 | 3874 | 178 | 0 | 0 | 0 | 4032 | 3016 | 1.34 |
| ecommerce | 7 | 6 | 0 | 0 | 1833 | 555 | 8 | 0 | 0 | 0 | 800 | 749 | 1.07 |
| events | 6 | 5 | 0 | 0 | 1169 | 390 | 8 | 0 | 0 | 0 | 760 | 538 | 1.41 |
| url-shortener | 5 | 4 | 0 | 0 | 492 | 306 | 2 | 0 | 0 | 0 | 520 | 498 | 1.04 |

Orthogonal routes are longer than beziers between the same points, so total
length on the small examples is not directly comparable. The ecommerce
example is also taller because ELK now leaves room for each label.

Tried and dropped: network-simplex placement with movable ports (shorter
edges, but ports slid onto node corners), a second layout pass that gives
busy nodes ports on their left and right sides (23 crossings, 13% longer),
and layering every edge by declaration order, not only cycles (9 crossings
and 46,629 px on the fixture, but it turns edges upward in documents whose
order isn't top-down). That one is now opt-in as `layout ordered` (below).

## With layout hints

`order-fulfillment-hinted.proschi` is the same diagram with the hints an
author would add to steer it towards the reference (docs/LANGUAGE.md,
"Steering the layout"): `layout ordered`, `rank 0` on the third-party
systems around the Order Fulfillment API, `rank 1` to `rank 4` on AWS
region 1, region 2, the Kafka cluster and GCP, and `direction right` in the
Kafka cluster so its topics form one row. `layoutMetrics.test.ts` checks its
thresholds and its shape: one aligned top row, the four groups one below the
other, the topics side by side.

| fixture | nodes | edges | unrouted | crossings | totalLength | maxLength | bends | overlaps | throughNodes | cornerEnds | width | height | aspect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| order-fulfillment (no hints) | 50 | 57 | 0 | 17 | 58908 | 3874 | 178 | 0 | 0 | 0 | 4032 | 3016 | 1.34 |
| order-fulfillment-hinted | 50 | 57 | 0 | 19 | 59067 | 4526 | 236 | 0 | 0 | 0 | 3309 | 3854 | 0.86 |
| only `layout ordered` | 50 | 57 | 0 | 11 | 49121 | 3145 | 175 | 0 | 0 | 0 | 2721 | 3590 | 0.76 |
| ranks and `direction`, no `layout ordered` | 50 | 57 | 0 | 33 | 61821 | 4375 | 256 | 0 | 0 | 0 | 3375 | 3734 | 0.90 |

The hinted layout has about as many crossings and as much edge length as the
plain one, but it has the reference's shape: externals in one row on top,
region 2 above the Kafka cluster (not below it), the topics in one row and
GCP at the bottom. `layout ordered` alone gives the lowest numbers, but its
externals are scattered over several rows. Ranks pin the rows, and the
ordered mode keeps the edges between them short.

How the engine does it (autoLayout.ts):

- `rank`: in each container that has ranked children, autoLayout computes
  the layers itself and passes them to ELK's interactive layering as
  positions. Connected nodes of one rank can't share a layer (layered layouts
  have no edges within a layer), so the target goes one layer lower. That's
  why the regions have ranks 1 and 2 and not one shared rank. ELK turns a
  centred label into a node of its own before layering, and interactive
  layering can't place it, so in these containers each label is a real
  stand-in node in a layer of its own, which the edge runs through.
- `direction` in a group: with INCLUDE_CHILDREN, ELK gives every group the
  root's direction, so a group with its own direction is laid out on its
  own and placed as one box. Edges across its border end at fixed ports
  straight across from the member they reach, and a short straight leg
  joins the port and the member. ELK can't route those legs around other
  members, so a port goes on whichever side has a clear way in.
