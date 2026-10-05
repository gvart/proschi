---
title: Payments with Idempotency
summary: Write the intent before the charge; replays never charge twice.
difficulty: hard
tags: [idempotency, consistency, queues, external-api, durability]
hints:
  - What happens if the service crashes right after the gateway approved the charge? INSERT something durable before you call the gateway, so every charge has a record.
  - "Make the idempotency key the primary key of a payments table in a strongly consistent store: an INSERT that conflicts tells you this is a retry, and the stored row holds the answer to give back. Do not SELECT first (two retries race), and keep caches out of it: they can lag or forget keys."
  - "Order matters in \"Charged\": gateway, then the ledger, then UPDATE the payment to succeeded with its stored response. A replay then reads a result that is only there once the money is booked."
  - "When the gateway call fails you do not know whether the card was charged. Answer 202 pending and put the payment on a queue. \"Retry charge\" starts at that queue: it hands the payment to a worker, which charges again with the same key (the gateway deduplicates too), books it, marks it succeeded and only then acknowledges the message."
  - The fallback scenario also lifts availability above the gateway's own 99.9%. Size the rest for 1k rps with two replicas of everything; one PostgreSQL primary takes the ~2k writes a second.
---

An online shop charges cards through an external payment gateway. The
gateway is slow (about **250 ms** per charge) and now and then times out. Mobile
clients on bad networks retry when they do not hear back in time, so the same
checkout often arrives twice. A shopper must **never be charged twice** for one
checkout, and a charge that went through must never be lost.

Every checkout carries an `Idempotency-Key` chosen by the client; a retry
sends the same key again.

## Functional requirements

- **Checkout**: the shopper sends `POST /payments` with the order, the amount
  and the idempotency key. Model it with three scenarios:
  - `"Charged"`: the key is new and the gateway approves; the money is
    booked in the ledger, the payment is marked succeeded with its response
    stored, and the shopper gets `201`.
  - `"Replay"`: the key was seen before (a retry); the shopper gets the
    stored result of the first attempt with a `2xx`, and nothing is charged
    or booked again.
  - `"Gateway down"`: the gateway call fails or times out. The shopper gets
    `202` with the payment *pending*; the charge is retried later in the
    background with the same key, and the ledger is written once it succeeds.
- **Retry charge**: the retry queue hands a pending payment to a worker,
  which charges it again with the same idempotency key, books the money in the
  ledger and marks the payment succeeded before acknowledging the message.

Use these names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- **1k checkouts per second** at peak (a sales event).
- About **5%** of them are retries of an earlier checkout.
- About **0.5%** of gateway calls fail or time out, so about **5 retries
  per second**.

## Constraints

- Before the gateway is called, the payment is **inserted** (a real write, not
  a lookup) into a **strongly consistent**, durable store, keyed by the
  idempotency key. A cache that can lag or forget keys is never consulted:
  it would let a retry charge twice. A crash at any point then leaves a
  trace to reconcile or retry.
- Money is booked in the ledger only after the gateway has approved the charge,
  and the payment is marked succeeded (with the response a retry gets back)
  only after the money is booked.
- p99 of a checkout under **1.5 s**, the gateway included; a replay is
  answered from the stored result in under **100 ms** at p99.
- Checkout available **99.95%** of the time, more than the gateway itself
  offers (99.9%).
- Every successful checkout, replays included, writes durably before the
  shopper hears back.
- Retries are driven by a queue, never by the shopper's request.
- Losing any single machine must not take checkout down.
- At most **$2,500 / month**, the finance ledger's three replicas included.

## What is given

`problem.proschi` declares the `shopper`, the external `gateway` (a card
processor: 250 ms per call, up to 5k calls per second) and the `ledger`, the
finance team's double-entry ledger API (three replicas) where only approved
money is booked: book with a write such as `APPEND entries`. Add the
payments service, where payments and their idempotency keys live, how failed
charges are retried, the connections and the use cases.

A relational database takes about **5k writes per second** on its primary,
whatever its number of replicas; replicas add only reads.
