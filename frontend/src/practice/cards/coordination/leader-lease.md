---
type: flip
difficulty: medium
tags: [availability]
---

## Front

Why does a leader hold a **lease** that expires (say after 10 s) rather
than a lock it keeps until it releases it?

## Back

If the leader crashes or is cut off, nobody has to prove it is dead: the
lease simply runs out and another node can take over. The leader renews it
well before expiry and must **stop acting as leader** as soon as it cannot,
on its own clock, be sure the lease is still valid.

## Why

Leases depend on clocks running at about the same rate, not on synchronized
clocks: the holder gives up a little early to allow for drift. They do not
protect against a holder that pauses and wakes up after expiry still
believing it leads; that needs fencing tokens.
