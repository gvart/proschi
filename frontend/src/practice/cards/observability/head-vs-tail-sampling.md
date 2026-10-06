---
type: flip
difficulty: hard
distinct-from: [context-propagation]
---

## Front

Head-based or tail-based trace sampling: what does each trade?

## Back

**Head**: decide at the first service (keep 1%) and pass the decision along.
Cheap and simple, but it keeps a random 1%, mostly ordinary requests, and
misses most rare errors and slow requests. **Tail**: decide once the trace is
complete, keeping every error and slow trace. It must buffer all spans of
every trace in collectors until then, and route each trace's spans to the
same collector.

## Why

A common mix: head-sample a small share for an unbiased baseline, and
tail-sample in collectors (such as the OpenTelemetry Collector) to keep the
interesting traces.
