---
title: Cache node lost
icon: server-crash
category: incident
topic: caching
learn: [cold-cache-restart, graceful-degradation]
effect: node-down
target: cache
duration: 1
telegraph: A cache host is scheduled for emergency maintenance.
counters: [circuit-breaker]
requires: [cache]
then: cache-stampede
min-wave: 5
---

## What happened

The whole cache went down for a tick. Requests fell back to the database, each paying a timeout on the cache first.

## Why

A cache is an optimisation, so the design should survive without it, but every request still pays for the failed call, and the database takes all the reads.

## What a senior engineer would do

Keep cache calls behind short timeouts and a circuit breaker, give the database headroom for a cache outage, and run the cache with replicas.
