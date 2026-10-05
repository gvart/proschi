---
type: estimate
difficulty: medium
tags: [estimation]
answer: 450
unit: ms
tolerance: 1.5
---

## Question

A user is 150 ms (round trip) from your only data center. Over a new
connection (TCP plus TLS 1.3), how long until the response to the first
request arrives, ignoring server time?

## Solution

TCP handshake: 1 round trip. TLS 1.3 handshake: 1 round trip. The request and
its response: 1 round trip. 3 × 150 ms = **450 ms**. Terminating connections
at a nearby edge and reusing connections removes most of it.

Numbers: [Numbers to know](../docs/numbers/#latency).
