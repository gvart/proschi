---
type: choice
difficulty: hard
tags: [consistency, replication]
distinct-from: [version-vectors, lamport-clock]
---

## Question

Two versions of a key carry the vector clocks `{A: 2, B: 1}` and
`{A: 1, B: 2}`. How are they related?

## Options

- [ ] The first is newer: it has the higher count for A
- [ ] The second is newer: B wrote last
- [x] They are concurrent: neither write had seen the other, so both must be kept or merged
- [ ] They are the same write seen by two nodes

## Why

One version follows another only if each of its counters is at least as
high. Here A's counter favours the first and B's the second, so neither
dominates. A write that merges them gets `{A: 2, B: 2}` plus one for the
node that writes it, and then follows both.
