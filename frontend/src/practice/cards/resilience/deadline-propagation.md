---
type: cloze
difficulty: hard
tags: [networking]
---

## Text

Passing the time a request has left along with each downstream call, so
services stop work the original caller has already given up on, is called
{{deadline propagation|deadline passing|deadlines}}.

## Why

gRPC supports this directly. Without it, a request that timed out at the edge can
keep doing expensive work in every service below.
