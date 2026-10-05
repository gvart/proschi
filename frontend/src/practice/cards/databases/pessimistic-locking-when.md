---
type: choice
difficulty: medium
tags: [consistency]
related: [ticket-booking]
---

## Question

When does pessimistic locking (`SELECT … FOR UPDATE`) beat optimistic
concurrency (a version check at write time)?

## Options

- [ ] When conflicts are rare
- [x] When many transactions fight over the same rows, so optimistic retries would keep failing
- [ ] When transactions are read-only
- [ ] When the data is spread over many shards

## Why

Optimistic concurrency costs nothing until a conflict, then the loser redoes
its work. Under heavy contention most attempts lose, so waiting for a lock is
cheaper. With rare conflicts, optimistic wins because nobody waits.
