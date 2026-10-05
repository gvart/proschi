---
type: choice
difficulty: medium
related: [notion-sharding]
distinct-from: [good-partition-key]
---

## Question

A document app stores pages as blocks. Most requests load many blocks of one
workspace. Which partition key fits?

## Options

- [ ] `block_id`
- [x] `workspace_id`
- [ ] `created_at`
- [ ] The id of the user who created the block

## Why

With `workspace_id`, a workspace's blocks live on one shard, so a request
touches one database and can use a transaction there. `block_id` scatters a
page over all shards, `created_at` makes the newest shard hot, and the
creator's id splits shared pages.
