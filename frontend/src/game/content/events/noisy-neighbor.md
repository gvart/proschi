---
title: Noisy neighbour
category: incident
topic: resilience
learn: [bulkheads, hedged-requests]
effect: latency
target: app
value: 3
duration: 3
telegraph: Another tenant on your hosts is running a huge batch job.
min-wave: 3
---

## What happened

App servers took three times as long per request for three ticks.

## Why

Shared hardware means shared caches, disks and network. When a neighbour hogs them, your service slows down even though nothing in it changed, and slower service time means longer queues at the same load.

## What a senior engineer would do

Keep latency headroom, spread replicas over hosts, isolate critical paths (bulkheads), and hedge or retry slow calls to another replica.
