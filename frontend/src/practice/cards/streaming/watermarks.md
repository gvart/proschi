---
type: cloze
difficulty: hard
distinct-from: [event-time]
---

## Text

A stream processor's running estimate that no more events older than time T
will arrive is called a {{watermark}}. Events older than it that arrive anyway
are {{late events|late event|late data|stragglers}}.

## Why

When the watermark passes the end of a window, the window's result is
emitted. A watermark that waits longer is more complete but delays results.
