---
type: choice
difficulty: medium
decks: [sample]
tags: [caching]
---

## Question

A Bloom filter says a key "might be present" or "is definitely not present".
Which mistake can it make?

## Options

- [x] False positives: it can say "might be present" for a key never added
- [ ] False negatives: it can say "not present" for a key that was added
- [ ] Both
- [ ] Neither; it is exact

## Why

That makes it a cheap guard in front of a slow lookup: a "not present" skips
the disk or database read entirely, and a rare false positive just costs one
unnecessary read.
