---
type: cloze
difficulty: medium
tags: [data-structures]
related: [distributed-kv]
---

## Text

When a quorum read finds a replica with an older version and writes the newer
value back to it, that is {{read repair}}. A background process that compares
replicas using {{Merkle trees|Merkle tree|hash trees|hash tree}} to find and
fix differences is called anti-entropy.

## Why

Read repair only fixes keys that get read; anti-entropy covers the rest. A
Merkle tree lets two replicas find which ranges differ by exchanging a few
hashes instead of all the data.
