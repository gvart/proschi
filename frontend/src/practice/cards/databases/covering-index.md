---
type: flip
difficulty: medium
---

## Front

What makes an index **covering** for a query, and why is it faster?

## Back

It contains every column the query reads, so the database answers from the
index alone and never fetches the table rows (an index-only scan). The cost is
a bigger index that every write must also update.
