---
type: flip
difficulty: medium
tags: [databases]
---

## Front

Two tables you often join end up on different shards. What are your options?

## Back

**Co-locate** them by sharding both on the same key (orders and their items
by `order_id`); **denormalize** the needed fields into one table; or **join in
the application** with a second lookup. Distributed joins and transactions
across shards exist, but they are slow and fragile.
