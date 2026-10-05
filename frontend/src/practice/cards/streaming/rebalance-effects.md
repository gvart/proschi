---
type: choice
difficulty: hard
tags: [queues]
---

## Question

A consumer joins a Kafka consumer group and partitions are rebalanced. What
can that cause?

## Options

- [ ] Messages are deleted from the topic
- [x] A short pause, and reprocessing of messages handled since the last committed offset
- [ ] Partitions lose their order
- [ ] Producers must stop until it ends

## Why

A partition's new owner starts from its committed offset, so work done but
not yet committed is done again. Frequent commits and idempotent processing
keep that cheap.
