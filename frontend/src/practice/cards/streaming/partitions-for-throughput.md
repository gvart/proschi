---
type: estimate
difficulty: easy
tags: [estimation]
answer: 30
unit: partitions
tolerance: 1.5
---

## Question

A topic must take 300 MB/s, and one consumer instance can process about
10 MB/s. How many partitions does the topic need so consumers keep up?

## Solution

You need 300 ÷ 10 = 30 consumers, and within a group each partition is read
by at most one consumer, so the topic needs at least **30 partitions**. Add headroom,
because adding partitions later moves keys to other partitions.
