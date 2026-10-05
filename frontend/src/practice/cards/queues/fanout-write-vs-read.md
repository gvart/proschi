---
type: flip
difficulty: medium
tags: [caching]
related: [news-feed]
distinct-from: [celebrity-fanout]
---

## Front

Fan-out on write versus fan-out on read for a feed: what does each cost?

## Back

**On write**: each post is copied into every follower's precomputed feed, so
reads are one cheap lookup, but writes multiply by the follower count and use
storage. **On read**: posting is one write, but every feed read gathers and
merges posts from everyone the user follows. Read-heavy feeds favour write.
