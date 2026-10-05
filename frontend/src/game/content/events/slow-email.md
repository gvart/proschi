---
title: Slow email provider
category: incident
topic: resilience
learn: [timeouts-on-every-call, queue-load-levelling, beat-your-dependency]
effect: external-slow
target: mail
value: 2000
duration: 3
telegraph: Your email provider's status page shows delayed sending.
counters: [circuit-breaker]
min-wave: 3
---

## What happened

Calls to the email provider took 2 seconds for three ticks.

## Why

Email is a classic dependency that does not need to be on the request path: the user does not wait for the receipt. Called inline, a slow provider is your slow checkout; called from a worker, it is a short backlog.

## What a senior engineer would do

Send email from a worker off a queue, with retries and backoff, and alert on the age of the oldest message rather than on the provider's latency.
