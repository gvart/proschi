---
type: estimate
difficulty: easy
related: [url-shortener]
answer: 3900
unit: reads/s
---

## Question

A URL shortener creates 100 million new links a month, and each link is read
100 times for every time one is created. What is the average read load?

## Solution

A 30-day month is 30 × 86,400 ≈ 2.6 million seconds. Writes: 100,000,000 ÷
2,592,000 ≈ 39 a second. Reads are 100× that: 39 × 100 ≈ **3,900 reads/s**
on average, so the system is clearly read-heavy and a cache in front of the
database pays off.

Numbers: [Numbers to know](../docs/numbers/#seconds-in-a-day-month-and-year).
