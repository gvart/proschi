---
type: flip
difficulty: medium
tags: [caching]
related: [api-gateway]
---

## Front

An API gateway caches each validated session token for 5 minutes instead of
asking the auth service on every call. What does that buy, and what does it
cost?

## Back

**Buys**: the auth service sees only the misses (at a 95% hit rate, 1 call in
20), and most calls skip a network hop. **Costs**: a token revoked at the auth
service keeps working until its entry expires. Keep the TTL short, and delete
the entry, or add a ban entry the gateway checks on every call, on logout or
when an account is blocked.

## Why

The TTL is the longest a revoked token can still be used. A few minutes is the
usual compromise between auth load and how fast a revocation takes effect.
