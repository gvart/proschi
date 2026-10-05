---
type: choice
difficulty: easy
related: [search-autocomplete]
---

## Question

Which job is fine as a daily batch rather than a stream?

## Options

- [ ] Blocking a fraudulent card payment
- [ ] Alerting when error rates spike
- [x] Rebuilding autocomplete suggestions from yesterday's query logs
- [ ] Showing what is trending in the last 5 minutes

## Why

Suggestions that are a day old are still useful, and a batch job over a full
day of logs is simpler and cheaper. The others lose their value in minutes.
