---
type: choice
difficulty: medium
tags: [databases]
related: [recommendations]
---

## Question

A ranking model needs features computed from months of logged interactions
for each of 500 candidates, within a 300 ms budget. Where should a request
read them?

## Options

- [ ] Query the data warehouse that holds the logs
- [x] A key-value store or cache that an offline job fills, in one batched read
- [ ] Recompute them from the raw events in the request
- [ ] Ask each candidate's author service in parallel

## Why

Features that summarise long histories change slowly, so compute them in
batches offline and load them into a fast online store. A warehouse query
takes around half a second and serves only a few hundred a second; the
online store answers 500 keys in about a millisecond. The cost is
staleness: the features are as old as the last batch.
