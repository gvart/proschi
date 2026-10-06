---
type: cloze
difficulty: medium
---

## Text

All the spans of one request share a {{trace id|trace ID}}. Each span has
its own {{span id|span ID}} and records its {{parent|parent span}}'s, which
is how the tracing system rebuilds the call tree.

## Why

A span covers one unit of work (an HTTP call, a query) with its start,
duration and attributes. Laid out as a tree on a timeline, the spans show
where the time went and which calls ran in sequence that could run in
parallel.
