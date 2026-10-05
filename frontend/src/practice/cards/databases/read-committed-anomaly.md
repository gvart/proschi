---
type: choice
difficulty: hard
tags: [consistency]
---

## Question

Under **read committed** isolation, which of these can still happen inside a
single transaction?

## Options

- [ ] Reading another transaction's uncommitted change (a dirty read)
- [x] Reading the same row twice and getting different values (a non-repeatable read)
- [ ] Losing a write after the commit was acknowledged
- [ ] Overwriting another transaction's uncommitted write (a dirty write)

## Why

Read committed only promises that you see committed data; another transaction
can commit between your two reads. Repeatable read or snapshot isolation gives
the whole transaction one consistent view.
