---
type: flip
difficulty: medium
tags: [availability, storage]
related: [github-repo-replication]
---

## Front

Replicating a disk to a standby versus replicating at the application level:
what does the second give you?

## Back

A replicated disk (active/standby) keeps an exact copy, but only the active
machine serves traffic, and the standby waits idle until failover.
Application-level replication makes every copy a **live, readable replica**,
so all of them serve reads, and the application can use quorums to keep
writing with one copy down.
