---
type: choice
difficulty: medium
tags: [replication]
related: [config-push]
---

## Question

A CDN's edge servers read customer settings on every request. Why does each server read them from a copy on its own disk rather than from the central config store?

## Options

- [x] Local reads take microseconds, and a data center cut off from the core keeps serving
- [ ] The central store cannot be replicated
- [ ] A local copy is always more up to date than the central store
- [ ] Local disks are cheaper per GB than the central store's disks

## Why

The central store would have to take every request's reads from every data center, and each request would wait on a link to the core and fail with it. A full local copy, updated in the background, takes the core off the request path entirely. The price is staleness: a change reaches the edge seconds after it is written.
