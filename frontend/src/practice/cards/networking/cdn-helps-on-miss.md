---
type: choice
difficulty: hard
tags: [caching]
related: [cdn-tiered-cache]
---

## Question

A user far from your origin requests a page the CDN has not cached. Why can
the CDN still make it faster than going to the origin directly?

## Options

- [x] The edge does the TCP and TLS handshakes near the user and reaches the origin over warm, reused connections
- [ ] Light travels faster on CDN fibre than on public networks
- [ ] The edge serves the page from the browser's cache
- [ ] The CDN skips the origin and builds the page itself

## Why

Handshakes cost several round trips. Doing them over a 10 ms hop to the edge
instead of a 150 ms hop to the origin saves most of that, and the edge's
connection to the origin is already open.
