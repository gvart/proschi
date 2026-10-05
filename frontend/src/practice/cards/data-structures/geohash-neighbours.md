---
type: choice
difficulty: medium
related: [ride-matching]
---

## Question

To find drivers near a rider, you look up the rider's geohash cell. Why must
you also search the neighbouring cells?

## Options

- [ ] Geohashes are only accurate in the northern hemisphere
- [x] A driver a few metres away can be just across a cell boundary, with a different prefix
- [ ] Each cell holds at most one driver
- [ ] Neighbouring cells hold the drivers' history

## Why

Cells are a grid, and a rider near an edge is closer to the next cell's
drivers than to the far side of their own. Querying the cell and its 8
neighbours covers the area around them.
