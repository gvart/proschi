---
type: choice
difficulty: hard
tags: [consistency, replication]
distinct-from: [raft-commit, raft-term]
---

## Question

In Raft, why can a node that missed recent committed entries not become the
leader?

## Options

- [ ] The old leader picks its own successor
- [x] Nodes refuse to vote for a candidate whose log is less up to date than their own, and a winner needs a majority
- [ ] Nodes with missing entries do not start elections
- [ ] The cluster waits until every node has caught up

## Why

A committed entry is stored on a majority, and any winner needs votes from a
majority. The two majorities overlap, so at least one voter has the entry and
refuses a candidate without it (logs are compared by last term, then
length). Every leader therefore holds all committed entries.
