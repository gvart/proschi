---
type: flip
difficulty: medium
decks: [sample]
tags: [consistency, availability]
---

## Front

Synchronous vs asynchronous replication: what does each give up?

## Back

**Synchronous**: the leader waits for the follower before acknowledging, so a
failover loses nothing, but every write is slower and a slow follower stalls
writes. **Asynchronous**: writes are fast, but a failover can lose the last
writes the follower had not received.
