---
type: flip
difficulty: medium
tags: [availability]
related: [distributed-cron]
---

## Front

In a distributed cron, why should the scheduler only **enqueue** due runs
instead of executing the scripts itself?

## Back

Running scripts takes CPU and memory for minutes or hours; scheduling takes
almost nothing. If the scheduler only records and enqueues each run, it
stays small and is never too busy to fire the next minute, a standby can
take over in seconds without killing any runs, and the scripts scale on a
worker pool sized for them.

## Why

A box that both schedules and runs everything has to grow with the scripts,
and losing it stops every script and every run in progress at once.
