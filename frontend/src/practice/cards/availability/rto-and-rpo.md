---
type: cloze
difficulty: easy
tags: [replication]
---

## Text

How much recent data you can afford to lose in a disaster, measured in time,
is the {{RPO|recovery point objective}}. How long you can afford to be down
is the {{RTO|recovery time objective}}.

## Why

Nightly backups mean an RPO of up to a day; asynchronous replication, seconds;
synchronous replication, zero. RTO depends on how automated the failover or
restore is.
