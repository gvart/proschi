---
type: estimate
difficulty: easy
tags: [storage]
answer: 860
unit: GB per day
---

## Question

1,000 servers each write 50 log lines a second, and a line averages 200 bytes.
How much log data is produced per day?

## Solution

1,000 × 50 × 200 B = 10,000,000 B = 10 MB/s. × 86,400 s = 864,000 MB ≈
**860 GB a day**, roughly 0.86 TB, or over 300 TB a year if all of it is
kept. Short retention and compression make that manageable.

Numbers: [Numbers to know](../docs/numbers/#seconds-in-a-day-month-and-year).
