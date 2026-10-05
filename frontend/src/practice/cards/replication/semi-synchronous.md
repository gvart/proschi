---
type: choice
difficulty: hard
tags: [availability]
distinct-from: [sync-vs-async-replication]
---

## Question

A leader has three followers. Which setup keeps writes fairly fast but still
guarantees that every acknowledged write is on at least two machines?

## Options

- [ ] Asynchronous replication to all three
- [ ] Synchronous replication to all three
- [x] Wait for any one follower to confirm, and replicate to the others asynchronously
- [ ] No followers, and a nightly backup

## Why

This is semi-synchronous replication. Waiting for one follower costs about one
round trip, and a single slow follower cannot stall writes, unlike waiting for
all three.
