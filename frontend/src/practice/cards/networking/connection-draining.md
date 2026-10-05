---
type: choice
difficulty: easy
tags: [availability]
---

## Question

You are about to take a server out of the load balancer for a deploy. What
should happen first so no user sees an error?

## Options

- [ ] Kill the process; clients will retry
- [x] Stop sending it new requests and let in-flight requests finish (draining)
- [ ] Lower the DNS TTL to zero
- [ ] Restart the load balancer

## Why

Draining (deregistration delay) keeps open requests and connections alive for
a bounded time while new traffic goes elsewhere. Long-lived connections such
as WebSockets need a reconnect plan, because draining cannot wait forever.
