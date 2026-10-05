---
type: flip
difficulty: hard
distinct-from: [watermarks]
---

## Front

An event arrives after its window's result was already emitted. What can a
stream job do with it?

## Back

**Drop it** (fine for approximate dashboards); keep windows open for an
**allowed lateness** and emit an updated result; or send it to a **side
output** that a batch job uses to correct the numbers later. Each trades
accuracy for state and complexity.
