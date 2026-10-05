---
type: choice
difficulty: easy
tags: [resilience]
distinct-from: [count-min-sketch]
---

## Question

Which structure estimates how many requests each of millions of IP addresses
has made, in fixed memory?

## Options

- [x] A count-min sketch
- [ ] A HyperLogLog
- [ ] A Bloom filter
- [ ] A trie

## Why

A count-min sketch estimates per-item frequencies. HyperLogLog estimates how
many distinct items there are, not how often each appears, and a Bloom filter
only answers "seen or not".
