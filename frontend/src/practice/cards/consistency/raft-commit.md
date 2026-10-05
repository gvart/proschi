---
type: flip
difficulty: medium
tags: [replication]
---

## Front

How does Raft commit a write?

## Back

Clients send writes to the **leader**, which appends the entry to its log and
sends it to the followers. Once a **majority** has stored it, the entry is
committed: the leader applies it and answers the client, and followers apply
it as they learn the commit point. A leader that loses its majority cannot
commit anything.
