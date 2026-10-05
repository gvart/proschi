---
type: flip
difficulty: hard
tags: [availability]
---

## Front

After a failover with async replication, the old leader comes back with
writes the new leader never got. What happens to them, and why is that risky?

## Back

They are usually **discarded** when the old leader rejoins as a follower. That
is dangerous if anything outside the database already saw them: for example,
reused auto-increment ids can collide with keys a cache or another system
stored for the lost rows. Promote the most up-to-date follower, and reconcile
the discarded writes by hand.
