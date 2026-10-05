---
type: cloze
difficulty: hard
tags: [resilience]
distinct-from: [cache-stampede]
---

## Text

To keep a hot key from expiring under load, a reader can refresh it at random
shortly before its TTL ends, more likely the closer expiry is. This is
{{probabilistic early expiration|probabilistic early recomputation|early recomputation|XFetch}}.

## Why

Because only an occasional reader refreshes early, the key is rebuilt once
instead of by thousands of readers at the moment it expires, without any
lock.
