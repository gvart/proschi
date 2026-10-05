---
type: cloze
difficulty: easy
---

## Text

Several workers pulling from one queue, so that each message is handled by
only one of them, is the {{competing consumers|competing consumer}} pattern.

## Why

It scales throughput by adding workers, and a crashed worker's messages go
back to the others.
