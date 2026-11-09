---
type: choice
difficulty: medium
tags: [estimation]
related: [multi-region-active-active]
distinct-from: [surviving-a-zone]
---

## Question

Two active regions each serve half the members. If one fails, DNS sends
everyone to the other. What is the most of its capacity each region may use
on a normal day?

## Options

- [x] Under 50%, so it can take the other half on top
- [ ] Under 70%, the usual hot threshold
- [ ] Under 90%, since failover is rare
- [ ] Any amount: the region scales out when traffic arrives

## Why

After the failover one region carries everything, so each must be able to
double its load: under 50% normally, a little less to keep room for a lost
instance. Scaling out as traffic shifts helps, but cold instances and caches
take time, so traffic is moved gradually. A third region lowers the bar: two
survivors split the load, so each may run at up to two thirds.
