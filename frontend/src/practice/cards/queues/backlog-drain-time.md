---
type: estimate
difficulty: medium
tags: [estimation]
answer: 60
unit: minutes
tolerance: 1.5
---

## Question

After an outage, a queue holds 1.8 million messages. Consumers process 2,000
a second, while producers keep adding 1,500 a second. How long until the
backlog is gone?

## Solution

The backlog shrinks by 2,000 − 1,500 = 500 messages a second. 1,800,000 ÷
500 = 3,600 s = **60 minutes**. Only the spare capacity drains a backlog, so
adding consumers for the recovery shortens it a lot.

Numbers: [Numbers to know](../docs/numbers/#how-to-estimate).
