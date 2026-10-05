---
name: Write batching
icon: package
rarity: uncommon
topic: queues
learn: [queue-load-levelling, pre-aggregate-counts]
effect: write-batching
value: 0.1
---

## Text

Workers write one batch for every 10 messages: background writes drop by 90%.

## Why

A worker that writes each message on its own pays the database's per-write cost every time. Collecting messages for a second and writing them in one multi-row insert or one counter increment moves the same data with a tenth of the writes.
