---
type: estimate
difficulty: easy
tags: [estimation]
related: [snowflake-ids]
answer: 4096000
unit: ids/s per worker
tolerance: 1.2
---

## Question

A Snowflake generator has a 12-bit sequence per millisecond. At most how many
ids can one worker issue per second?

## Solution

2¹² = 4,096 ids per millisecond. × 1,000 ms = **4,096,000 ids/s**, about 4
million. When the sequence runs out, the generator waits for the next
millisecond.

Numbers: [Numbers to know](../docs/numbers/#powers-of-two-and-ten).
