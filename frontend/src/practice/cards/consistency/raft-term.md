---
type: cloze
difficulty: medium
distinct-from: [raft-commit]
---

## Text

Each Raft election starts a new {{term}}. A node votes for at most one
candidate per term, so at most one {{leader}} can be elected in it.

## Why

Messages carry the term, so a node that sees a higher term steps down. That is
how an old leader coming back from a partition finds out it was replaced.
