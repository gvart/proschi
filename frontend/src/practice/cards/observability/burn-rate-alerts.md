---
type: flip
difficulty: hard
tags: [availability]
---

## Front

Why alert on the error budget's **burn rate** over two windows rather than
on "error rate above 1% for 5 minutes"?

## Back

Burn rate is how fast the budget is spent: 1 uses it up exactly at the end
of the SLO window. **Page on fast burns** (14.4× over 1 hour spends 2% of a
30-day budget) and open a ticket for slow ones (1× over 3 days). Each alert
also needs a short window (5 minutes for the 1-hour one) to agree, so it
stops firing soon after the problem ends.

## Why

A fixed threshold pages for short blips that cost little budget and misses
a slow leak that spends it all by the end of the month. Tying alerts to the
budget makes them track what users actually lose.
