---
type: flip
difficulty: medium
tags: [queues]
related: [job-queue, web-crawler]
distinct-from: [at-least-once-needs-idempotency]
---

## Front

A Kafka consumer can commit its offset before or after processing a message.
What does each give you?

## Back

**Commit after processing**: a crash in between reprocesses the message, so
**at-least-once** (consumers must be idempotent). **Commit before**: a crash
in between skips it, so **at-most-once**. Pick by which is worse for you: a
duplicate or a lost event.
