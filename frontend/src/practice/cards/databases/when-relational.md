---
type: choice
difficulty: easy
---

## Question

Which workload most clearly calls for a relational database?

## Options

- [x] Orders, payments and stock that need multi-row transactions and ad hoc queries
- [ ] Billions of sensor readings written and read by device and time
- [ ] Session blobs looked up only by session id
- [ ] Cached HTML fragments with a TTL

## Why

Relational databases shine at transactions, constraints and joins. Sensor
data suits a time-series or wide-column store, and session or cache data a
key-value store.
