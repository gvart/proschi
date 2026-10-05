---
type: choice
difficulty: hard
tags: [consistency]
related: [snowflake-ids]
---

## Question

A Snowflake id generator sees its clock jump **backwards** by 50 ms. What
should it do?

## Options

- [x] Refuse to issue ids, or wait, until the clock passes the last timestamp it used
- [ ] Reset the sequence to 0 and carry on
- [ ] Pick a new random worker id
- [ ] Ignore it; the sequence keeps ids unique

## Why

Reusing timestamps it has already issued ids for would create duplicates with
the same worker id and sequence. Waiting out a small jump is safe; a large one
should take the generator out of service.
