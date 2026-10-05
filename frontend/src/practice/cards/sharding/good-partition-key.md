---
type: flip
difficulty: medium
related: [notion-sharding]
---

## Front

What makes a good partition key?

## Back

**Many distinct values** with fairly even load, so no shard gets hot, and a
match with the access pattern, so most requests touch **one shard**. A key
that spreads data perfectly but forces every query to ask all shards is a
bad key.
