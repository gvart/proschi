---
name: Covering index
icon: list-ordered
rarity: common
topic: databases
learn: [covering-index, composite-index-prefix]
effect: latency
target: db
value: 0.6
---

## Text

Database queries take 40% less time.

## Why

A query whose columns are all in the index is answered from the index alone, without a second lookup into the table for every row. Fewer pages read means less time per query and more queries per second from the same disk.
