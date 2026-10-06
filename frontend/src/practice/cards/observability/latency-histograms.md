---
type: flip
difficulty: medium
related: [metrics-ingest]
distinct-from: [averaging-percentiles]
---

## Front

Why record latency as a **histogram** (counts per bucket) rather than as a
p99 each server computes for itself?

## Back

Bucket counts add up across servers, regions and time, so any percentile
can be computed afterwards for the whole fleet, one endpoint or any window.
A percentile computed on each server cannot be combined. The cost is
precision: an answer is only as exact as the bucket edges around it.

## Why

Put bucket edges near the SLO threshold (an edge at exactly 300 ms makes
"share under 300 ms" exact), or use exponential histograms, which keep the
relative error small at every scale.
