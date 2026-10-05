---
type: choice
difficulty: medium
tags: [availability]
---

## Question

A request goes through services A → B → C → D. A, B and C each make up to 3
attempts when their call fails. If D is down, how many calls can one user
request send to D?

## Options

- [ ] 3
- [ ] 9
- [x] 27
- [ ] 81

## Why

Attempts multiply at each layer: 3 × 3 × 3 = 27. Retrying at every layer turns
an overloaded service into a crushed one. Retry at one layer only, and cap
retries with a budget (e.g. at most 10% extra traffic).
