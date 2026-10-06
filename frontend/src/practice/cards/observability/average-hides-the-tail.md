---
type: choice
difficulty: easy
distinct-from: [fan-out-tail-latency]
---

## Question

An endpoint's average latency is a steady 50 ms. Why might users still
complain that it is slow?

## Options

- [x] The average hides the tail: 2% of requests taking 2 s barely moves it
- [ ] Averages are always measured on the server, not the client
- [ ] 50 ms is too slow for any endpoint
- [ ] The average counts failed requests twice

## Why

98 requests at 10 ms and 2 at 2 s average about 50 ms, yet one in fifty
users waits 2 seconds, and a heavy user making dozens of calls hits that
often. Track p50, p95 and p99 (or p99.9 for large fan-outs) instead.
