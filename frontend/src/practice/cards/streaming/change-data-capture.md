---
type: flip
difficulty: hard
tags: [databases, consistency]
---

## Front

What is **change data capture** (CDC), and why use it to keep a search index
in sync?

## Back

CDC reads the database's own replication log (the binlog or WAL, e.g. with
Debezium) and publishes every committed row change as an event. The search
index is updated from those events, with **no dual writes** in the app that
could fail halfway, and in commit order.
