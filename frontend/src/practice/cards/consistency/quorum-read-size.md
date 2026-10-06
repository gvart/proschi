---
type: choice
difficulty: medium
decks: [sample]
tags: [replication]
related: [distributed-kv]
---

## Question

A key is stored on N = 3 replicas, and writes wait for W = 2 of them. How
many replicas must a read ask (R) to be sure it sees the latest write?

## Options

- [ ] 1
- [x] 2
- [ ] 3
- [ ] It cannot be guaranteed with replicas

## Why

When R + W > N, every read set overlaps every write set in at least one
replica. 2 + 2 > 3, so R = 2 suffices, and it survives one replica being down.
