---
type: choice
difficulty: medium
tags: [availability]
---

## Question

Why do teams avoid setting an SLO of 100%?

## Options

- [ ] Monitoring tools cannot measure 100%
- [x] Users cannot tell it from 99.99% through their own networks, and it leaves no budget for changes
- [ ] SLAs forbid it
- [ ] 100% is impossible to compute over a month

## Why

A user on mobile data sees far more failures from their own connection than
from a 99.99% service. A 100% target makes every deploy, failover and
experiment a violation, so the team either stops shipping or ignores the
SLO. Pick the lowest target users are happy with.
