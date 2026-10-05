---
type: cloze
difficulty: medium
tags: [networking]
---

## Text

A network round trip inside one data center takes about
{{0.5 ms|half a millisecond|500 µs|500 microseconds}}, while a round trip from
California to Europe takes about {{150 ms|150 milliseconds}}.

## Why

Both are approximate, but the ratio (hundreds of times) is the point: a
design that makes several sequential cross-continent calls per request cannot
be fast, whatever the servers do. That is why data and caches are placed close
to users.
