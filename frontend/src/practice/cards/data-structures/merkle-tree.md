---
type: cloze
difficulty: medium
tags: [replication]
related: [distributed-kv]
distinct-from: [read-repair]
---

## Text

In a {{Merkle tree|hash tree}}, every parent holds a hash of its children's
hashes. Two replicas compare their {{root}} hashes first and descend only
into the subtrees whose hashes differ.

## Why

If the roots match, the replicas agree, after exchanging one hash. If not,
they find the few differing ranges in a logarithmic number of steps. Git,
Cassandra and blockchains all use the idea.
