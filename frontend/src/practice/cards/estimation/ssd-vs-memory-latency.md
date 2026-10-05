---
type: choice
difficulty: easy
tags: [storage]
---

## Question

About how much slower is a random 4 KB read from an SSD than a read from main
memory?

## Options

- [ ] About the same; both are electronic
- [ ] About 10× slower
- [x] About 1,000× slower (roughly 100 µs vs 100 ns)
- [ ] About 1,000,000× slower

## Why

Rough numbers worth knowing: main memory about 100 ns, an SSD random read
tens to a hundred-odd microseconds, a spinning-disk seek about 10 ms. That gap
is why hot data lives in a memory cache such as Redis instead of being read
from disk on every request.
