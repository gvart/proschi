---
title: Bulk import
category: spike
topic: sharding
learn: [replicas-do-not-scale-writes, shards-for-write-rate, queue-load-levelling]
effect: write-surge
value: 4
duration: 2
telegraph: A big customer is about to import everything they have.
counters: [write-batching]
min-wave: 4
---

## What happened

The scenario's main write use case ran at four times its usual rate for two ticks.

## Why

Read replicas add read capacity only: every write still goes to one primary per shard. A write spike finds that limit fast.

## What a senior engineer would do

Shard for write throughput, or put the writes behind a queue so a burst becomes a backlog the workers drain at a steady rate.
