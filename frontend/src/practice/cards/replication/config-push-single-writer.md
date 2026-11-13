---
type: flip
difficulty: medium
tags: [availability, consistency]
related: [config-push]
---

## Front

A config system sends every write through one root, which numbers the changes in order for its replicas. What does the single writer buy, and what must you add because of it?

## Back

It buys a simple total order: one counter, no global write coordination, and a replica can spot a missed change by a gap in the sequence numbers. Because every write needs the root, it must not be one machine: run a primary and a secondary, or a root failure stops every change.
