---
type: flip
difficulty: hard
tags: [consistency]
---

## Front

With a leader in each region, what new problem appears, and how is it
handled?

## Back

The same record can be changed in two regions at once, giving a **write
conflict** found only later. Options: **last write wins** (simple, but drops
one write), merging (CRDTs or app logic), or avoiding conflicts by giving each
record a **home region** that takes all its writes.
