---
type: cloze
difficulty: medium
tags: [replication]
related: [shopping-cart]
---

## Text

Data types such as grow-only counters and add-wins sets, which merge
concurrent updates from different replicas automatically and always converge
to the same value, are called
{{CRDTs|CRDT|conflict-free replicated data types|conflict-free replicated data type}}.

## Why

They let every replica accept writes without coordination, which suits
collaborative editing, counters and carts. Not every operation can be
expressed that way, such as "only if the balance stays positive".
