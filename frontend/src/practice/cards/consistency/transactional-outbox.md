---
type: choice
difficulty: medium
tags: [queues, databases]
related: [payments]
---

## Question

A service must save an order and publish an "order created" event, and never
do one without the other. How?

## Options

- [ ] Publish the event, then write the order
- [ ] Write the order, then publish the event
- [x] Write the order and the event to an outbox table in one transaction; a relay publishes from it
- [ ] Publish the event and let a consumer write the order later

## Why

Either two-step order leaves a gap: a crash between the steps loses one
side. The outbox makes both one database transaction; the relay (polling or
CDC) publishes at least once, so consumers must deduplicate.
