---
type: flip
difficulty: medium
tags: [resilience]
---

## Front

Why do services keep **persistent, pooled connections** to each other instead
of opening one per request?

## Back

Every new connection costs handshake round trips, TLS CPU work and a slow
start while TCP ramps up. Reusing warm connections removes that from each
request. The pool needs a size limit and timeouts, so a slow dependency
cannot exhaust it.
