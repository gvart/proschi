---
name: Connection pooling
icon: cable
rarity: common
topic: databases
learn: [connection-pooler, connection-pool-size]
effect: capacity
target: db
stat: rps
value: 1.2
---

## Text

Databases take 20% more reads and writes.

## Why

Every database connection costs the server memory and a process or thread. Hundreds of app server instances each opening their own connections waste most of that on idle connections. A pooler (PgBouncer, RDS Proxy) multiplexes many client connections onto a few busy ones, so the same database does more useful work.
