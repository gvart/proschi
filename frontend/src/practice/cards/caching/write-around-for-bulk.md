---
type: choice
difficulty: medium
tags: [databases]
---

## Question

A job imports 50 million records that are rarely read in the days after.
Which cache write policy fits?

## Options

- [ ] Write-through: write the cache and the database on every write
- [ ] Write-back: write the cache, flush to the database later
- [x] Write-around: write only the database; reads fill the cache when needed
- [ ] Refresh-ahead: reload every key before it expires

## Why

Writing the import through the cache would evict the keys people actually
read in favour of records nobody asks for. Write-around keeps the cache for
what is read, at the cost of a miss on the first read of a new record.
