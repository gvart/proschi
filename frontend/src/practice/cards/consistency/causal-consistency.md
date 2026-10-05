---
type: choice
difficulty: hard
---

## Question

In a comment thread, a reader sees a reply before the question it answers.
What is the **weakest** guarantee that rules this out?

## Options

- [ ] Linearizability
- [x] Causal consistency
- [ ] Read-your-writes
- [ ] Eventual consistency

## Why

Causal consistency guarantees that if one write depends on another, everyone
sees them in that order. Linearizability also prevents it but costs much more;
read-your-writes only covers your own writes, and eventual consistency allows
any order for a while.
