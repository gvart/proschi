---
title: Notification storm
category: spike
topic: queues
learn: [backlog-drain-time, scale-on-message-age, celebrity-fanout]
effect: write-surge
target: async
value: 3
duration: 2
telegraph: A celebrity with millions of followers is about to post.
counters: [autoscaler]
requires: [queue]
min-wave: 4
---

## What happened

The background use case ran at three times its usual rate for two ticks.

## Why

A queue absorbs a burst only if the workers can drain it afterwards. The backlog grows by the difference between arrivals and capacity, and takes as long to drain as the spare capacity allows.

## What a senior engineer would do

Scale workers on queue age, not CPU, keep spare capacity to drain bursts, and set a freshness objective so you notice before users do.
