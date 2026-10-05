---
type: choice
difficulty: hard
tags: [databases]
related: [news-feed]
distinct-from: [cursor-vs-offset-pagination]
---

## Question

A feed is paged with a cursor on `created_at`. Why should the cursor also
include the post id?

## Options

- [x] Posts can share a timestamp, so (created_at, id) is needed for a unique order that never skips or repeats rows
- [ ] The id makes the cursor harder to guess
- [ ] Databases cannot index timestamps
- [ ] It lets clients jump directly to page 50

## Why

With only the timestamp, "after 12:00:00.123" skips other posts from that same
instant. A composite cursor plus an index on (created_at, id) keeps the order
total and the seek fast.
