---
type: choice
difficulty: medium
tags: [streaming]
---

## Question

When does a log like Kafka fit better than a queue like SQS or RabbitMQ?

## Options

- [x] Several services read the same events independently, and you may want to replay history
- [ ] Each job must be done once by any one of many workers
- [ ] Individual messages need delays and priorities
- [ ] Throughput is a few messages a minute

## Why

A log keeps messages after they are read, and each consumer group tracks its
own position, so new readers and replays are free. A queue deletes a message
once it is handled, and offers per-message features like delays and
visibility timeouts.
