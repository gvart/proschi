---
title: Rate Limiter
summary: Reject over-limit callers before they reach the service.
difficulty: easy
tags: [caching, edge, protection]
hints:
  - The counters must be shared by every limiter replica. Which kind of store answers in about a millisecond?
  - "Write the limit check before the call to the Orders API, and leave the call out of the \"Limited\" scenario altogether. The check is a write: INCR the counter and decide on the value it returns."
  - Every component needs a second replica to survive losing one machine; size the limiter for 5k rps at well under 70% busy.
---

The Orders API is being hammered by a few noisy clients. Put a rate
limiter in front of it: each client may make at most **100 requests per
minute**; anything above that is rejected with `429 Too Many Requests`
before it reaches the Orders API.

## Functional requirements

- **Call API**: a client calls `GET /orders`. Model it with two scenarios:
  - `"Allowed"`: the client is under its limit; the request reaches the
    Orders API and the client gets `200`.
  - `"Limited"`: the client is over its limit and gets `429`; the Orders
    API never sees the request.

Use these names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- **5k rps** in total, of which about 5% is over the limit.
- Counters must be shared: the limiter runs on several machines and a client
  may hit any of them.
- Every call counts, allowed or not: the limiter increments the client's
  counter (an atomic write such as `INCR`) before deciding. Reading the
  counter and incrementing it later lets bursts through.

## Constraints

- p99 of a call under **200 ms**, including the limit check.
- Available **99.9%** of the time.
- Losing any single machine must not take the API down.
- Nothing reaches the Orders API without passing the limiter: no connection
  from the client straight to it.
- At most **$3,000 / month** for everything, the Orders API included.

## What is given

`problem.proschi` declares the `client` and the `orders` service (five
replicas, already sized for the allowed traffic) and holds the traffic,
requirements and tests. Add the limiter, where its counters live, the
connections and the use case.
