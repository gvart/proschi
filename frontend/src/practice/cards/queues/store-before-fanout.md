---
type: flip
difficulty: medium
tags: [consistency]
related: [news-feed]
---

## Front

Why must a new post be stored durably **before** its fan-out is queued?

## Back

If fan-out runs first and anything fails, the post is lost while some feeds
point to it. Stored first, the post is the source of truth: fan-out can be
retried from it at any time, and every feed entry refers to a post that
exists.
