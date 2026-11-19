---
type: cloze
difficulty: medium
tags: [storage]
related: [metrics-ingest]
---

## Text

An LSM tree first puts writes in an in-memory {{memtable|mem table}}, flushes it to
disk as immutable sorted files called {{SSTables|SSTable|sorted string tables|SS tables|SST files|SSTs}},
and merges those files in the background, which is called {{compaction|compacting}}.

## Why

A write-ahead log alongside the memtable keeps writes safe until the flush.
