---
type: choice
difficulty: hard
tags: [data-structures]
related: [distributed-kv]
distinct-from: [consistent-hashing]
---

## Question

Why does consistent hashing give each server many **virtual nodes** on the
ring instead of one position?

## Options

- [ ] So each key is stored on several servers
- [x] To even out the load, and so a leaving server's keys spread over many servers instead of one neighbour
- [ ] To make lookups take constant time
- [ ] To avoid hashing the keys at all

## Why

With one point each, servers get very uneven arcs of the ring, and a failed
server dumps its whole arc on its single neighbour. Many points per server
average out the arcs; giving bigger machines more points also weights them.
