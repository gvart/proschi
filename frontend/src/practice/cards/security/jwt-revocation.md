---
type: flip
difficulty: hard
---

## Front

A user logs out or is banned, but their JWT access token is still valid for
an hour. Why can't you just revoke it, and what are the options?

## Back

Services accept a JWT by checking its signature and `exp` alone, without
asking any store, so nothing can take it back before it expires. Options:
keep access tokens **short-lived** (5–15 minutes) and revoke the
**refresh token**, which is checked against a store; keep a **denylist** of
revoked token ids (`jti`) checked on each request until they expire; or use
opaque tokens that services look up (introspection).

## Why

Each fix brings back some of the lookup that stateless tokens avoided. The
usual compromise is short access tokens plus revocable refresh tokens: a
revoked user keeps access for at most a few minutes.
