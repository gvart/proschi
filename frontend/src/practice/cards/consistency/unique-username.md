---
type: cloze
difficulty: medium
tags: [databases]
---

## Text

Making sure two people cannot register the same username at the same moment
needs a {{linearizable|strongly consistent|consensus}} operation, such as a
unique constraint or a compare-and-set.

## Why

With eventual consistency, two replicas can each accept the name and only
find the conflict later, when one user has to be told their account name
changed.
