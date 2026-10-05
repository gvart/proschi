---
type: cloze
difficulty: medium
decks: [sample]
tags: [resilience]
related: [social-graph-cache]
---

## Text

When a hot key expires and thousands of requests miss at once and all hit the
database, it is a {{cache stampede|thundering herd|dogpile}}. Letting one
request rebuild the value while the others wait for it is called
{{request coalescing|single flight|singleflight|coalescing}}.

## Why

Other fixes: refresh hot keys before they expire, and add random jitter to
TTLs so many keys do not expire in the same second.
