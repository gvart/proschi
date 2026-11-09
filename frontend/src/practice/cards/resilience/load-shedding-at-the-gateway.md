---
type: choice
difficulty: medium
tags: [availability]
related: [load-shedding]
---

## Question

A backend gets 125% of what it can serve, mostly low-priority log uploads.
Where should those requests be rejected?

## Options

- [ ] In the backend, which knows best what each request costs
- [x] At the gateway in front of it, before they are forwarded
- [ ] In the database, when its connection pool is full
- [ ] Nowhere: queue them in the backend until the spike passes

## Why

A backend that rejects a request has already accepted the connection, read
and parsed it: during an overload that work is the problem. The gateway sees
every request first, can rank it by priority and drop the lowest before the
backend spends anything. The gateway then needs capacity for the whole spike,
shed requests included.
