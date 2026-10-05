---
type: flip
difficulty: medium
---

## Front

What is a **bulkhead**, and what failure does it prevent?

## Back

Separate, limited pools of threads or connections for each dependency (or
kind of work), like the watertight compartments of a ship. When one
dependency gets slow, only its pool fills up; calls to everything else still
have resources, so one bad dependency cannot take the whole service down.
