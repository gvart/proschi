---
type: cloze
difficulty: medium
distinct-from: [raft-term, raft-vote-restriction]
---

## Text

Raft followers wait a {{randomized|random}} election timeout (for example
150–300 ms) without hearing from a leader before starting an election, so
that usually one node times out first and wins before the others try, which
avoids repeated {{split votes|split vote|tied elections}}.

## Why

If every follower used the same timeout, they would all become candidates
at once, each vote for itself, and no one would get a majority. The timeout
must be well above the time it takes to send a message, or elections happen
needlessly.
