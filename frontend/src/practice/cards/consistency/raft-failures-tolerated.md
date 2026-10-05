---
type: choice
difficulty: easy
tags: [availability]
---

## Question

A Raft cluster has 5 nodes. How many can fail while it still commits writes?

## Options

- [ ] 1
- [x] 2
- [ ] 3
- [ ] 4

## Why

A write commits once a majority stores it: 3 of 5. With 2 nodes down, the
remaining 3 are still a majority. In general, 2f + 1 nodes tolerate f
failures.
