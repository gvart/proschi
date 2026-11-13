---
type: choice
difficulty: medium
tags: [caching]
related: [recommendations]
---

## Question

A recommender retrieves 500 candidates per request and has a cheap
distilled model and a deep model 20 times dearer per item. What keeps the
cost and latency bounded?

## Options

- [x] Cheap passes narrow the 500 down, so the deep model scores only the last few dozen
- [ ] Score all 500 with the deep model and cache its scores per user
- [ ] Score all 500 with the cheap model only and drop the deep one
- [ ] Run the deep model on all 500 in parallel, so latency stays one call

## Why

A ranking funnel spends each model where it pays: the distilled model rates
all 500, a mid-size network the best 150, and the deep model only the best
50. Its load falls tenfold. Caching scores per user rarely hits, because
candidates change on every visit, and parallel calls cut latency, not the
machines they need.
