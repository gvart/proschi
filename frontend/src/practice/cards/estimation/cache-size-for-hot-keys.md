---
type: estimate
difficulty: medium
tags: [caching]
related: [url-shortener]
answer: 50
unit: GB
---

## Question

A service stores 500 million short links. You want to cache the hottest 20%
of them, and each cache entry (key, URL and overhead) takes about 500 bytes.
How much cache memory is that?

## Solution

20% of 500 million = 100 million entries. 100,000,000 × 500 B =
50,000,000,000 B = **50 GB**. That fits in the memory of a handful of cache
nodes, with replicas on top.

Numbers: [Numbers to know](../docs/numbers/#sizes).
