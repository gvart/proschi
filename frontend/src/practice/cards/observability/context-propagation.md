---
type: choice
difficulty: medium
tags: [queues]
distinct-from: [trace-and-span-ids]
---

## Question

Service A calls B over HTTP and also sends it jobs through a queue, but B's
spans show up as separate traces instead of under A's. What is the likely
cause?

## Options

- [ ] The clocks of A and B are out of sync
- [ ] B's sampling rate is too low
- [x] A does not pass the trace context (such as the W3C `traceparent` header) with its calls and messages
- [ ] B writes its logs as plain text

## Why

Every hop must carry the trace id and parent span id: HTTP and gRPC headers,
and message headers or attributes for queues. Instrumentation libraries
(OpenTelemetry) do it for supported clients; hand-made HTTP clients and
queue producers are where the chain usually breaks.
