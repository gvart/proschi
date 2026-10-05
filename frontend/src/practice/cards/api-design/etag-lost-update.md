---
type: cloze
difficulty: hard
tags: [consistency]
---

## Text

To stop two clients from overwriting each other's edits, the server returns
an {{ETag}} with the resource, and the client sends it back in an
{{If-Match}} header when updating. A stale value gets
{{412|412 Precondition Failed|Precondition Failed}}.

## Why

This is optimistic concurrency over HTTP: no locks are held, and the loser
re-reads the resource and retries its change.
