---
type: flip
difficulty: medium
tags: [resilience]
related: [notification-fanout]
---

## Front

A consumer's call to a provider fails. How do you retry it later without
blocking the messages behind it?

## Back

Do not sleep in the consumer. Republish the message with a delay (delayed
delivery, or a chain of retry queues with growing delays) and acknowledge the
original. After the last retry, send it to a dead-letter queue.
