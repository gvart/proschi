---
type: choice
difficulty: medium
tags: [estimation]
---

## Question

Three servers behind a load balancer report p99 latencies of 100 ms, 200 ms
and 900 ms. What is the p99 for the whole service?

## Options

- [ ] 400 ms, their average
- [ ] 900 ms, the slowest
- [ ] 200 ms, the median
- [x] It cannot be computed from these numbers: merge the servers' latency histograms instead

## Why

Percentiles do not add up or average: the answer depends on how many
requests each server took and how its latencies are spread. It lies
somewhere between 100 and 900 ms. Bucket counts of histograms can be summed
across servers, so record histograms and compute percentiles afterwards.
