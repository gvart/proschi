---
type: flip
difficulty: easy
tags: [queues, storage]
---

## Front

Kafka keeps messages after consumers read them. What does that make possible?

## Back

Messages stay for a **retention period** (by time or size), whoever has read
them. So a new consumer can start from the beginning, a consumer with a bug
can **rewind and reprocess**, and several services read the same data at
their own pace.
