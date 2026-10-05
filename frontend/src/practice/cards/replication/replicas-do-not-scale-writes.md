---
type: flip
difficulty: easy
tags: [sharding]
related: [notion-sharding, ticket-booking]
---

## Front

A database is overloaded by writes. Why does adding read replicas not help?

## Back

Every replica must apply **every write** the primary takes, so replicas add
read capacity but no write capacity; the primary still does all the writes
alone. To add write capacity you shard (split the data across several
primaries) or reduce the writes (batching, aggregation).
