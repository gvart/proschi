---
type: choice
difficulty: medium
tags: [availability]
distinct-from: [odd-cluster-size, nodes-for-three-failures]
---

## Question

A 5-node etcd cluster spans three availability zones. Which placement keeps
it writable when any one zone goes down?

## Options

- [x] 2, 2 and 1 nodes
- [ ] 3, 1 and 1 nodes
- [ ] 3, 2 and 0 nodes
- [ ] All 5 in the most reliable zone

## Why

Writes need 3 of 5. With 2/2/1, losing any zone leaves at least 3. With
3/1/1, losing the zone with 3 leaves only 2, and the cluster stops accepting
writes. Spread the nodes so that no zone holds more of them than the cluster
can lose.
