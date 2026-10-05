---
type: flip
difficulty: medium
decks: [sample]
tags: [databases]
related: [news-feed]
---

## Front

Why do feeds use cursor pagination instead of `?page=N` (offset)?

## Back

An offset makes the database skip N rows, which gets slower the deeper you go,
and new items shift the pages, so users see duplicates or miss posts. A cursor
(e.g. "after id 8231") seeks with an index and stays stable as items arrive.
