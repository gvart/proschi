---
type: choice
difficulty: medium
tags: [caching]
---

## Question

You need a compact "is this key in the set?" filter like a Bloom filter, but
keys must also be **deleted**. What fits?

## Options

- [ ] A standard Bloom filter
- [x] A cuckoo filter
- [ ] A HyperLogLog
- [ ] A count-min sketch

## Why

A standard Bloom filter cannot delete: clearing a key's bits may clear bits
other keys share. A cuckoo filter stores small fingerprints that can be
removed, at similar memory. A counting Bloom filter also allows deletes but
uses more memory.
