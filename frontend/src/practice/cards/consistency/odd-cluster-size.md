---
type: choice
difficulty: hard
tags: [availability]
distinct-from: [raft-failures-tolerated]
---

## Question

Why do consensus clusters (etcd, ZooKeeper) use 3 or 5 nodes rather than 4?

## Options

- [x] 4 nodes need a majority of 3, so they survive only 1 failure, the same as 3 nodes, with more traffic
- [ ] An even number of nodes can never elect a leader
- [ ] 4 nodes would need two leaders
- [ ] Odd numbers make hashing faster

## Why

Adding a fourth node raises the majority from 2 to 3 without raising the
number of failures tolerated. It also adds one more node to every write.
