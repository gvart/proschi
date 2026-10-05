---
type: choice
difficulty: easy
decks: [sample]
tags: [realtime]
related: [notification-fanout]
---

## Question

An "order placed" event must reach the email service, the analytics service
and the warehouse service. Which messaging model fits?

## Options

- [ ] A work queue: each message goes to exactly one consumer
- [x] Pub/sub: each subscribing service gets its own copy
- [ ] A single shared database table that every service polls
- [ ] Direct HTTP calls from the order service to all three

## Why

A work queue spreads messages among competing workers of one service.
Pub/sub delivers each event to every subscriber, so new services can be added
without changing the publisher.
