---
name: Read replicas everywhere
icon: copy-plus
rarity: uncommon
topic: replication
learn: [replicas-do-not-scale-writes]
effect: capacity
target: db
stat: reads
value: 1.6
downside: cost
downside-target: db
downside-value: 1.35
---

## Text

Databases take 60% more reads. But every database costs 35% more: the followers run all day.

## Why

Followers copy the primary's writes and answer reads, so read capacity grows with each one. They do nothing for writes, which every follower has to replay too, and you pay for each copy whether the reads come or not.
