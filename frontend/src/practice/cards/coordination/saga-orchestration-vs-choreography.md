---
type: flip
difficulty: medium
tags: [queues]
related: [payments]
distinct-from: [saga-over-2pc, saga-isolation]
---

## Front

Saga **orchestration** or **choreography**: what does each trade?

## Back

**Orchestration**: one coordinator tells each service what to do and runs
the compensations when a step fails. The flow lives in one place, easy to
follow, change and monitor, but the orchestrator is one more service to run.
**Choreography**: each service reacts to events and publishes its own. No
central piece and loose coupling, but the flow is spread across services,
hard to see and test.

## Why

Choreography suits two or three steps; longer flows usually move to an
orchestrator or a workflow engine (Temporal, AWS Step Functions), which also
keeps the saga's state across crashes.
