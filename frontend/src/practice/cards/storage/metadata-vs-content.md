---
type: flip
difficulty: easy
tags: [databases]
related: [pastebin, file-storage]
distinct-from: [object-vs-block-storage]
---

## Front

A paste or file service stores both small facts (owner, expiry, size) and
large bodies. Where does each go, and why?

## Back

The **metadata** goes in a database, where it can be queried, indexed and
updated in transactions. The **content** goes in object storage, keyed by an
id the metadata row holds. Each store does what it is good at, and the
database stays small enough to fit in memory.
