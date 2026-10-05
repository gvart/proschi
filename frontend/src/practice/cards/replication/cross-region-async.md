---
type: choice
difficulty: easy
tags: [availability, networking]
---

## Question

Why is replication between distant regions usually asynchronous?

## Options

- [ ] Synchronous replication cannot cross regions
- [x] Every commit would wait a cross-region round trip, often 50–150 ms
- [ ] Asynchronous replication never loses data
- [ ] Regions use different database versions

## Why

The price of async is a small window of writes that a regional failure can
lose (the RPO). Systems that need zero loss across regions pay the latency,
often with a nearby third region to keep it down.
