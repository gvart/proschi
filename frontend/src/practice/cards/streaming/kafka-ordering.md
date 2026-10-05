---
type: flip
difficulty: medium
decks: [sample]
tags: [queues]
related: [trending-topics]
---

## Front

What ordering does Kafka guarantee, and how do you keep one user's events in
order?

## Back

Order is guaranteed **only within a partition**. Use the user id as the message
key: every event with the same key goes to the same partition, so one user's
events stay in order while different users are processed in parallel.
