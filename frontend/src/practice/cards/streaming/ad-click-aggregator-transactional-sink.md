---
type: flip
difficulty: hard
tags: [consistency]
related: [ad-click-aggregator, metrics-ingest]
distinct-from: [checkpointed-state, at-least-once-needs-idempotency, offset-commit-timing]
---

## Front

A Flink job's state is exactly-once thanks to checkpoints, but it writes
aggregates to a Kafka topic. How do you stop a crash from publishing the
same aggregate twice, and what does it cost?

## Back

Write the output in a **Kafka transaction** and **commit it only when the
checkpoint completes** (a two-phase commit). Downstream readers use
`read_committed`, so they never see output of a run that crashed; the job
replays from the checkpoint and writes it again. The cost is **delay**:
output becomes visible once per checkpoint interval.

## Why

Uber's ad event pipeline checkpoints every two minutes instead of Flink's
default ten for this reason: the interval is how stale the aggregates may
be. A record UUID on each aggregate still lets sinks such as a database
deduplicate, for the readers outside the transaction.
