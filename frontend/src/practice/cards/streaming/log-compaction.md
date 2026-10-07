---
type: cloze
difficulty: medium
tags: [storage]
related: [collaborative-docs]
distinct-from: [kafka-retention]
---

## Text

A Kafka topic with {{log compaction|compaction}} keeps at least the latest
message for each key and removes older ones, so the topic stays a complete
snapshot of current values.

## Why

Useful for changelogs and state: a new service rebuilds a full table by
reading the compacted topic. A message with a null value (a tombstone) deletes
the key.
