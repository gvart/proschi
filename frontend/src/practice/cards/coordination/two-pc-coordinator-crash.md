---
type: choice
difficulty: hard
tags: [consistency, databases]
distinct-from: [two-phase-commit-blocking]
---

## Question

In two-phase commit, every participant voted yes, then the coordinator
crashed before sending its decision to anyone. What may a participant do?

## Options

- [ ] Commit after a timeout, since everyone voted yes
- [ ] Abort after a timeout to release its locks
- [x] Nothing on its own: keep its locks and wait until it learns the decision
- [ ] Ask a majority of participants to vote again

## Why

The coordinator may have logged "commit" just before crashing, or decided
to abort, so committing or aborting alone could break atomicity. Asking
other participants helps only if one of them heard the decision. This is
the blocking problem; consensus-based commit (as in Spanner) replicates the
decision so it survives the coordinator.
