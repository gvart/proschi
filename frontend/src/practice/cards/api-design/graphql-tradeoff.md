---
type: choice
difficulty: medium
tags: [caching]
---

## Question

What is a common cost of GraphQL compared with a REST API?

## Options

- [ ] Clients must fetch more data than they need
- [x] HTTP caching is harder, because queries usually go as POSTs to one endpoint
- [ ] It cannot describe types or a schema
- [ ] It needs a WebSocket for every query

## Why

GraphQL fixes over- and under-fetching, which is REST's weakness, but CDNs and
browsers cannot cache by URL, and a single query can be expensive to run
(nested resolvers, N+1 queries), so servers need query cost limits.
