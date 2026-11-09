---
type: choice
difficulty: medium
tags: [data-structures]
related: [nearby-search]
---

## Question

You shard a nearby-people index by location, grouping map cells into
geoshards. How should the cells be grouped so no geoshard runs hot?

## Options

- [ ] Equal areas: every geoshard covers the same number of cells
- [ ] One geoshard per country
- [x] Equal load: score each cell by its users and searches, and group neighbouring cells until a geoshard reaches its share
- [ ] Random cells per geoshard, so load evens out

## Why

Users are packed into cities, so equal areas put a whole city in one hot
geoshard. Balancing by load splits a metro into small geoshards and lets a
sparse region share one. Cells stay contiguous, so a search still reads only
a few geoshards; random grouping would scatter every search over all of them.
