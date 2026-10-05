---
type: estimate
difficulty: easy
tags: [estimation]
related: [push-gateway, chat]
answer: 200
unit: servers
tolerance: 1.5
---

## Question

At peak, 10 million clients hold WebSocket connections. One server
comfortably holds 50,000. How many servers do you need?

## Solution

10,000,000 ÷ 50,000 = **200 servers**. Add headroom so that when a server
dies, its 50,000 clients can reconnect to the others without overloading them.

Numbers: [Numbers to know](../docs/numbers/#connections).
