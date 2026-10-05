---
type: choice
difficulty: hard
tags: [databases, consistency]
---

## Question

Users are sharded by `user_id`, and you add a **global** secondary index on
`email`, itself partitioned by email. What do you pay for fast email lookups?

## Options

- [ ] Every email lookup must ask all shards
- [x] A write can touch two shards, so the index is often updated asynchronously and may lag
- [ ] Emails must be unique across shards
- [ ] Users can no longer be found by `user_id`

## Why

The alternative, a **local** index on each shard, keeps writes on one shard
but makes every lookup by email a scatter-gather over all shards.
