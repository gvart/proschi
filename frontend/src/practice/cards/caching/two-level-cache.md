---
type: flip
difficulty: medium
---

## Front

You add an in-process cache on each app server in front of a shared Redis.
What do you gain and what do you pay?

## Back

**Gain**: hits with no network hop at all, and less load on Redis. **Pay**:
each server holds its own copy, so memory is duplicated and invalidation must
reach every server (or you accept staleness up to a short TTL). Keep the
local layer small and its TTL short.
