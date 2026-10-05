---
type: flip
difficulty: hard
tags: [consistency]
---

## Front

How does MVCC let readers and writers avoid blocking each other, and what
does it cost?

## Back

A write creates a **new version** of the row instead of overwriting it, and
each transaction reads the versions visible in its own snapshot. So readers
never wait for writers. The cost: old versions pile up and must be cleaned up
(Postgres `VACUUM`), and long transactions keep them alive.
