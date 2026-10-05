---
name: Spot workers
rarity: uncommon
topic: queues
learn: [competing-consumers]
effect: spot
target: worker
value: 0.4
---

## Text

Workers cost 60% less, but lose one replica whenever an incident is under way.

## Why

Spot instances are spare capacity sold cheaply and taken back at short notice. They suit work that can be retried and waits in a queue, never the request path.
