---
type: flip
difficulty: hard
related: [snowflake-ids]
---

## Front

Why can random (v4) UUID primary keys make inserts slow on a large B-tree
table?

## Back

Each new key lands at a random place in the index, so inserts touch pages all
over it: more cache misses, more page splits and a bigger, fragmented index.
**Time-ordered ids** (UUIDv7, Snowflake-style) append near the end of the
index, which stays in memory.
