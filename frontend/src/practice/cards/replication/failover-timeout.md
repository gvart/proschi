---
type: flip
difficulty: hard
tags: [availability]
---

## Front

How long should followers wait without hearing from the leader before failing
over? What does each choice risk?

## Back

**Too short**: a GC pause or a load spike looks like a crash, causing
needless failovers, which add load and can cause a split brain. **Too long**:
a real crash means a longer outage for writes. Typical values are seconds to
tens of seconds, tuned to the network's normal delays.
