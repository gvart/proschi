---
type: flip
difficulty: hard
tags: [resilience]
---

## Front

A stream job keeps counts in memory. How does it recover after a crash
without double-counting?

## Back

It takes periodic **checkpoints** that store its state together with the
input **offsets** it had reached. After a crash it restores the last
checkpoint and replays input from those offsets, so state reflects each
event exactly once (Flink works this way). Output to other systems still
needs idempotent or transactional writes.
