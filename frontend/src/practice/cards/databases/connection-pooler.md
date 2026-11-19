---
type: cloze
difficulty: easy
tags: [resilience]
---

## Text

Postgres starts a process for each connection, so thousands of app instances
should share a small number of connections through a pooler such as
{{PgBouncer|pg bouncer|RDS Proxy|pgpool|pgpool-II|Odyssey|PgCat|Supavisor|pgagroal}}.

## Why

Each Postgres connection costs memory, and past a few hundred, throughput
drops as connections compete. A pooler hands a real connection to a client
only for the length of a transaction.
