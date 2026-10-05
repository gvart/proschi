---
type: choice
difficulty: hard
tags: [consistency, availability]
---

## Question

The old leader is cut off by a network partition, a follower is promoted, and
now both accept writes. What prevents this **split brain**?

## Options

- [ ] A shorter heartbeat timeout
- [ ] Adding more followers
- [x] Electing leaders by majority vote and rejecting writes that carry an older term (a fencing token)
- [ ] Restarting the old leader automatically when it reconnects

## Why

Only one side of a partition can hold a majority, so only one leader can be
elected per term. A fencing token (the term or epoch number) lets storage and
followers reject an old leader that does not yet know it was replaced.
