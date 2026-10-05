---
type: flip
difficulty: hard
tags: [consistency]
related: [ticket-booking]
---

## Front

Two doctors are on call. Each, in their own transaction, checks "at least two
are on call" and takes themselves off. Both commit, and no one is on call.
What anomaly is this, and how do you prevent it?

## Back

**Write skew**: each transaction read the same data and updated a different
row, so snapshot isolation sees no conflict. Prevent it with **serializable**
isolation, or lock the rows the decision read (`SELECT … FOR UPDATE`).
