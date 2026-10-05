---
type: choice
difficulty: medium
tags: [replication, availability]
related: [shopping-cart]
---

## Question

A shopping cart must accept "add item" even during a network partition or
when a database node is down. Which design fits?

## Options

- [ ] One SQL primary with synchronous replicas
- [ ] A Raft group per cart
- [x] Leaderless replication with versioned carts merged on read
- [ ] Two-phase commit between the cart replicas

## Why

The requirement picks availability over consistency (AP). Any replica takes
the add, concurrent versions are kept and merged (union of items), and the
cost is that a removed item can occasionally reappear.
