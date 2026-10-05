---
type: choice
difficulty: easy
tags: [availability]
---

## Question

A service gets 150% of the load it can handle. What keeps it most useful?

## Options

- [ ] Accept every request and let them all slow down
- [ ] Queue every request until there is capacity
- [x] Reject the excess early and cheaply (429 or 503), serving the rest at normal speed
- [ ] Restart the servers to clear their memory

## Why

Accepting everything makes every request slow, so many time out and all the
work is wasted. Shedding keeps the served requests fast; shed the least
important traffic first and tell clients when to retry.
