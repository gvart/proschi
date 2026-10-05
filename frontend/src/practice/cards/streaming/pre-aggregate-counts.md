---
type: flip
difficulty: medium
tags: [databases]
related: [view-counting, metrics-ingest]
---

## Front

A million view events a second must update per-video counts. Why aggregate in
the stream before writing to a database?

## Back

The stream job sums views per video in memory and writes **one update per
video per window** (say every 10 seconds) instead of one per event. Writes drop
by orders of magnitude, and hot videos no longer hammer a single row. The
counts lag by up to one window.
