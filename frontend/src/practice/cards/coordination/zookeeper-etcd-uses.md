---
type: flip
difficulty: medium
related: [snowflake-ids]
---

## Front

What are ZooKeeper and etcd good for, and what should you not store in
them?

## Back

Small, critical, strongly consistent data that many nodes must agree on:
**leader election, locks, configuration, membership and shard
assignments**, with watches that notify clients when it changes. Not
application data or high write rates: every write goes through one leader
and a majority, and the whole dataset is meant to stay small.

## Why

etcd limits requests to about 1.5 MB by default and suggests keeping the
database under 8 GB; ZooKeeper caps a node's data at about 1 MB and keeps
everything in memory. They coordinate the system; they are not its database.
