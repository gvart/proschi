---
type: flip
difficulty: easy
tags: [availability]
distinct-from: [error-budget]
---

## Front

How do an SLI, an SLO and an SLA relate?

## Back

An **SLI** is a measurement: the share of requests that succeeded within
300 ms. An **SLO** is the internal target for it: 99.9% over 30 days. An
**SLA** is a contract with customers, with refunds or penalties when broken.
The SLA is set looser than the SLO, so the team reacts before money is at
stake.

## Why

Good SLIs measure what users see, ideally at the load balancer or client,
not CPU or memory. The gap between the SLO and 100% is the error budget.
