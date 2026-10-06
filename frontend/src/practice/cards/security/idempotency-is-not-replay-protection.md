---
type: flip
difficulty: hard
tags: [api-design]
related: [payments]
distinct-from: [idempotency-key-design, webhook-receiver]
---

## Front

An API already requires idempotency keys. Does that protect it against an
attacker replaying a captured request?

## Back

No. Idempotency keys stop the **client's own retries** from doing the work
twice, and only while the key is stored (often 24 hours); a replay after
that, or with a new key, runs again. Replay protection needs the request to
be **signed with a timestamp** (and a nonce), rejected when older than a few
minutes, with nonces remembered for that window.

## Why

TLS already stops replays on the wire; this matters for requests that are
captured or passed along, like webhooks and signed API calls. The two
mechanisms solve different problems and are often used together.
