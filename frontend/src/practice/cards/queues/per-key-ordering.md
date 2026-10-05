---
type: choice
difficulty: medium
tags: [streaming]
---

## Question

Events for each bank account must be processed in order, but the total volume
needs hundreds of consumers. What do you do?

## Options

- [ ] Use a single consumer for everything
- [x] Partition by account id, so each account's events go to one partition or message group, handled in order
- [ ] Let consumers sort events by timestamp after reading
- [ ] Give up ordering and process events in parallel

## Why

Ordering only matters within an account, so you get order there and
parallelism across accounts. Kafka partition keys and SQS FIFO message groups
both work this way.
