---
type: flip
difficulty: medium
tags: [resilience]
related: [payments]
---

## Front

How should a server implement **idempotency keys** for a "create payment"
endpoint?

## Back

Store each key with a hash of the request and the response, under a **unique
constraint** in a durable, consistent store. On a repeat, return the stored
response instead of doing the work again; reject the same key with a
different body. Expire keys after a window such as 24 hours.
