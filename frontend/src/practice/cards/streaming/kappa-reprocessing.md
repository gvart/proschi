---
type: choice
difficulty: hard
---

## Question

In a Kappa architecture (stream processing only, no separate batch layer),
how do you recompute results after fixing a bug?

## Options

- [x] Replay the retained log through the fixed job into a new output, then switch readers over
- [ ] Run a separate batch job over the database
- [ ] Ask producers to resend their events
- [ ] It is not possible; results stay wrong

## Why

The log is the source of truth, kept long enough to replay. Lambda
architecture instead runs a batch layer beside the stream, which means writing
the same logic twice.
