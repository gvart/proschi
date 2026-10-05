---
type: choice
difficulty: easy
tags: [queues]
---

## Question

A Kafka topic has 12 partitions, and a consumer group has 20 consumers. How
many of them receive messages?

## Options

- [x] 12
- [ ] 20
- [ ] 8
- [ ] 1

## Why

Within a group, each partition is read by exactly one consumer, so the
partition count caps a group's parallelism; the other 8 sit idle as spares.
Choose the partition count with future consumers in mind.
