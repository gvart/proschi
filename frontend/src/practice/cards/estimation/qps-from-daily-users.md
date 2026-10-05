---
type: estimate
difficulty: easy
decks: [sample]
related: [url-shortener]
answer: 2300
unit: requests/s
---

## Question

An app has 10 million daily active users, and each makes 20 requests a day.
What is the average load in requests per second?

## Solution

10,000,000 × 20 = 200,000,000 requests a day. A day has 86,400 seconds, about
100,000, so 200M ÷ 86,400 ≈ **2,300 requests/s** on average. Peak is usually
2–3× the average, so plan for 5,000–7,000.

Numbers: [Numbers to know](../docs/numbers/#per-day-to-per-second).
