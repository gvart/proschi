---
type: choice
difficulty: medium
tags: [consistency]
---

## Question

Raft and Paxos solve the same problem. What is the main reason Raft became
the common choice in new systems (etcd, Consul, CockroachDB)?

## Options

- [ ] Raft tolerates more failures with the same number of nodes
- [ ] Raft needs no majority to commit
- [x] Raft specifies a whole replicated log, with a strong leader, elections and membership changes, and is easier to understand
- [ ] Raft also tolerates nodes that lie (Byzantine faults)

## Why

Both need a majority and survive f crashed nodes out of 2f + 1; neither
handles malicious nodes. Basic Paxos agrees on one value, and the
multi-value version leaves many practical details open, so Paxos
implementations differed. Raft was designed to be understandable.
