---
type: flip
difficulty: easy
---

## Front

What is the N+1 query problem, and how do you fix it?

## Back

Code loads a list with one query, then runs one more query **per item** (for
example, each post's author): 1 + N round trips. Fix it by fetching the
related rows **in one query**, with a join or `WHERE id IN (…)`, or a batching
loader.
