---
title: Slow provider
category: incident
topic: resilience
learn: [timeouts-on-every-call, queue-load-levelling, beat-your-dependency]
effect: external-slow
value: 1500
duration: 3
telegraph: A provider you depend on shows degraded performance on its status page.
counters: [circuit-breaker]
min-wave: 3
---

## What happened

Calls to the external provider took 1.5 seconds for three ticks.

## Why

You cannot make a third party faster. If a request waits on it, your latency is its latency; if a queue sits between you, its slowness becomes a backlog instead.

## What a senior engineer would do

Never call a slow third party on the request path when the user does not need its answer: enqueue the work, answer at once, and let workers retry with backoff.
