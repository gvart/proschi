---
type: choice
difficulty: easy
tags: [availability]
---

## Question

Which metric best tells you a worker fleet should scale up?

## Options

- [ ] CPU usage on the message broker
- [x] The age of the oldest message, or the backlog per worker
- [ ] The number of producers
- [ ] The average message size

## Why

Message age measures what users feel: how long work waits. Worker CPU can be
low while workers wait on slow downstream calls, so it can miss a growing
backlog.
