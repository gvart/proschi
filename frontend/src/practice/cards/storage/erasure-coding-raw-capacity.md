---
type: estimate
difficulty: medium
tags: [estimation]
answer: 1.4
unit: PB raw
tolerance: 1.2
distinct-from: [erasure-coding]
---

## Question

You store 1 PB of data with 10 + 4 erasure coding (each 10 data pieces get 4
parity pieces). How much raw disk do you need, before headroom?

## Solution

Each 10 units of data take 14 units of disk: 1 PB × 14 ÷ 10 = **1.4 PB**.
Three-way replication of the same data would take 3 PB.

Numbers: [Numbers to know](../docs/numbers/#powers-of-two-and-ten).
