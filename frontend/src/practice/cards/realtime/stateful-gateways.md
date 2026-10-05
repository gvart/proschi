---
type: flip
difficulty: medium
tags: [availability]
related: [chat, push-gateway]
---

## Front

Why are WebSocket servers harder to run than stateless HTTP servers?

## Back

Each holds **long-lived connections**, so it is stateful: other servers must
find which one holds a user, a deploy or crash drops thousands of connections
at once, and load balancers cannot rebalance existing connections. Capacity is
counted in open connections (memory, file descriptors), not requests a second.
