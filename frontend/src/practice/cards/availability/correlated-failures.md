---
type: choice
difficulty: medium
---

## Question

The math said two replicas give about 99.9999%, but both went down together.
Which assumption broke?

## Options

- [x] That the two replicas fail independently
- [ ] That availabilities multiply in series
- [ ] That the replicas use the same software version
- [ ] That a replica's availability is under 100%

## Why

Shared racks, power, networks, zones, configuration pushes and the same bug
can take down both at once. Spread replicas over failure domains and roll out
changes gradually so failures stay independent.
