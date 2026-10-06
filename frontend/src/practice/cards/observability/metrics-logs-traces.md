---
type: flip
difficulty: easy
---

## Front

Metrics, logs and traces: what question does each answer best?

## Back

**Metrics** (cheap numbers over time): *is* something wrong, and how much?
They drive dashboards and alerts. **Traces** (one request across services):
*where* is it slow or failing? **Logs** (detailed events): *why* did this
request fail? A typical investigation goes alert → trace → logs.

## Why

They cost differently: a metric costs the same at 10 or 10,000 requests a
second, while logs and traces grow with traffic, so they are often sampled.
Sharing a trace id across all three lets you jump between them.
