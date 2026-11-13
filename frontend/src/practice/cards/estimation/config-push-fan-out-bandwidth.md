---
type: estimate
difficulty: medium
tags: [replication, networking]
related: [config-push]
answer: 400
unit: MB/s
---

## Question

A root store receives 1,000 configuration changes a second, each about 2 KB, and sends every change straight to 200 data centers. How much does the root send each second?

## Solution

1,000 × 200 × 2 KB = 400,000 KB ≈ **400 MB/s**, from the one place every write lands. With six intermediate nodes between, the root sends 1,000 × 6 × 2 KB = 12 MB/s, and the intermediate tier shares the 400 MB/s. A fan-out tree spreads the copying over many machines.

Numbers: [Numbers to know](../docs/numbers/#disks-and-networks).
