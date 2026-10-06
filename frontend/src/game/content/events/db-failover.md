---
title: Database primary dies
icon: database-zap
category: incident
topic: replication
learn: [failover-timeout, async-failover-loss]
effect: failover
target: db
duration: 2
telegraph: The database primary's disk is showing errors.
counters: [fast-failover]
requires: [db]
then: write-surge
min-wave: 3
---

## What happened

The primary failed. With a replica to promote, writes stopped for the first tick of the failover and the database ran one replica short. Without one, the database was down until it was repaired.

## Why

A single-primary database has exactly one node that takes writes. Replicas keep reads going and one of them can be promoted, but detection and promotion take time, and an asynchronous replica may lose the last writes.

## What a senior engineer would do

Always run a replica in another zone, automate failover, and put writes that can wait behind a queue so a short write outage becomes a short backlog instead of failed requests.
