---
type: cloze
difficulty: easy
tags: [storage]
---

## Text

Before acknowledging a commit, a database appends the change to its
{{write-ahead log|WAL|redo log|commit log}} and flushes it to disk, so a crash
can be recovered by replaying it.

## Why

An append is a fast sequential write, while the actual data pages can be
updated later. Replicas often follow the same log.
