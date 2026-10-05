---
type: flip
difficulty: medium
related: [ride-matching]
---

## Front

When would you pick a quadtree over a fixed geohash grid?

## Back

When density is very uneven. A quadtree **splits a cell only when it holds
too many points**, so a city centre gets tiny cells and a desert stays one
big cell, and each lookup scans a similar number of points. A geohash grid is
simpler and works as a plain database key, but its cells are the same size
everywhere.
