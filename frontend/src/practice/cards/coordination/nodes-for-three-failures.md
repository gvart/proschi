---
type: estimate
difficulty: easy
tags: [consistency, availability]
answer: 7
unit: nodes
tolerance: 1.1
distinct-from: [raft-failures-tolerated, odd-cluster-size]
---

## Question

How many nodes does a consensus cluster (Raft, ZooKeeper) need to keep
working with any 3 of them down?

## Solution

It needs a majority of all nodes alive. To tolerate f failures you need
2f + 1 nodes: 2 × 3 + 1 = **7 nodes**, whose majority is 4. With 6, the
majority is also 4, so only 2 may fail. Most clusters stop at 5: every extra
node joins every write.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
