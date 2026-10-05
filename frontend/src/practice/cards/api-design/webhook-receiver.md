---
type: flip
difficulty: medium
tags: [queues]
---

## Front

What should a webhook receiver do so forged, replayed or repeated deliveries
cannot hurt it?

## Back

**Verify the signature** (an HMAC of the body with a shared secret) and reject
old timestamps to block replays. **Answer 2xx quickly** and do the work from a
queue. **Deduplicate by event id**, because senders retry and deliver at least
once.
