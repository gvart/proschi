---
type: estimate
difficulty: easy
tags: [estimation, storage]
answer: 45
unit: nodes
tolerance: 1.5
---

## Question

You store 60 TB of data with 3 replicas of everything, and each node can hold
4 TB. How many nodes do you need, ignoring headroom?

## Solution

60 TB × 3 replicas = 180 TB in total. 180 ÷ 4 = **45 nodes**. In practice
you keep disks well below full, which makes it 60 or more.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
