---
type: estimate
difficulty: medium
tags: [estimation]
answer: 120
unit: MB
tolerance: 1.5
distinct-from: [bloom-filter]
---

## Question

A Bloom filter for 100 million keys with a 1% false-positive rate needs about
9.6 bits per key. How much memory is that?

## Solution

100,000,000 × 9.6 bits = 960,000,000 bits. ÷ 8 = 120,000,000 bytes ≈
**120 MB**. Storing the keys themselves (say 20 bytes each) would take 2 GB.
Each tenfold drop in the false-positive rate costs about 4.8 more bits per
key.

Numbers: [Numbers to know](../docs/numbers/#powers-of-two-and-ten).
