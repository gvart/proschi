---
type: choice
difficulty: medium
tags: [queues]
related: [payments]
---

## Question

Placing an order spans the payment, inventory and shipping services, each
with its own database and team. What is the usual way to keep them
consistent?

## Options

- [ ] Two-phase commit across the three databases
- [x] A saga: local transactions in order, each with a compensating action if a later step fails
- [ ] One shared database for all three services
- [ ] Retry every step forever until it succeeds

## Why

A saga avoids locks held across services. If shipping fails, the saga runs
the compensations: release the stock, refund the payment. It is orchestrated
by a coordinator or choreographed with events.
