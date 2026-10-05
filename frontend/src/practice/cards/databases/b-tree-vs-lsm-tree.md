---
type: choice
difficulty: hard
decks: [sample]
tags: [storage]
related: [metrics-ingest]
---

## Question

A service ingests millions of small writes a second and reads them rarely.
Which storage engine design suits it best?

## Options

- [ ] A B-tree, updating pages in place
- [x] An LSM tree, appending to a log and merging sorted files in the background
- [ ] A hash index kept entirely in memory
- [ ] Any of them; the engine does not affect write throughput

## Why

LSM trees (Cassandra, RocksDB) turn random writes into sequential appends,
which is far faster on disk. They pay for it on reads, which may check several
files, and with background compaction.
