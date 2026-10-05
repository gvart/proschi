---
type: flip
difficulty: easy
tags: [storage]
---

## Front

Why do sites name static files with a content hash, like `app.3f9a2c.js`?

## Back

A file with a given name never changes, so browsers and CDNs can cache it
**for a year** (`immutable`). A new release produces new file names, so users
get it immediately, with no purge and no stale mixes of old and new files.
Only the small HTML page that links them needs a short TTL.
