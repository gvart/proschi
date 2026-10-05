---
type: flip
difficulty: hard
tags: [streaming]
related: [trending-topics]
distinct-from: [count-min-sketch]
---

## Front

How do you track the top 100 hashtags in a stream with millions of distinct
tags, in bounded memory?

## Back

Count with a **count-min sketch**, and keep a **min-heap of 100** entries.
After each update, if a tag's estimated count beats the smallest in the heap,
it replaces it (or its entry is updated). The heap's root is always the
threshold to get into the top 100.
