---
type: choice
difficulty: medium
tags: [availability]
---

## Question

Service instances start and stop every few minutes as they autoscale. How do
callers find the healthy ones?

## Options

- [ ] A list of IP addresses in each caller's config file
- [ ] DNS records with a one-day TTL
- [x] A service registry fed by health checks (e.g. Consul, Kubernetes endpoints)
- [ ] Broadcasting a request to the whole subnet

## Why

Instances register (or are registered by the platform) and are removed when
health checks fail. Callers, or a load balancer in front of them, read the
registry, so the list stays current without redeploying anything.
