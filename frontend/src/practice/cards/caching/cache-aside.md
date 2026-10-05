---
type: flip
difficulty: easy
decks: [sample]
related: [url-shortener]
---

## Front

Walk through a read with the **cache-aside** pattern.

## Back

1. The app looks up the key in the cache.
2. On a hit, it returns the value.
3. On a miss, it reads the database, writes the value into the cache (with a
   TTL) and returns it.

The cache holds only what was asked for, and the app owns all the logic.
