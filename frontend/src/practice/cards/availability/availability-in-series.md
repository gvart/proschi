---
type: choice
difficulty: medium
decks: [sample]
---

## Question

A request passes through two components in a row, each 99.9% available.
What is the availability of the whole path?

## Options

- [x] About 99.8%
- [ ] 99.9%
- [ ] About 99.9999%
- [ ] 99.95%

## Why

In series, both must be up: 0.999 × 0.999 ≈ 0.998. Every hop lowers the
total. Redundancy works the other way: two copies in parallel are down only
when both are, 1 − 0.001² = 99.9999%.
