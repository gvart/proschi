---
type: flip
difficulty: hard
tags: [data-structures]
distinct-from: [b-tree-vs-lsm-tree]
---

## Front

A key in an LSM tree may be in any of dozens of SSTables. What keeps reads
from checking all of them?

## Back

A **Bloom filter per SSTable** skips files that cannot hold the key, a
**sparse index** finds the right block in a file in one seek, and
**compaction** keeps the number of files low. Recent data is answered from the
memtable and caches.
