---
type: choice
difficulty: medium
related: [news-feed]
---

## Question

A feed cache stores each user's feed as a list of post ids, and the posts
themselves in a separate cache. Why split them?

## Options

- [ ] Ids compress better than posts
- [x] An edited post is updated in one place, not in every feed that contains it
- [ ] It lets the cache skip TTLs
- [ ] Posts cannot be stored in a list

## Why

A popular post can be in millions of feeds. Copying whole posts would make
every edit, like count or deletion a million-way write; with ids, the feed
lists stay small and the post objects change once.
