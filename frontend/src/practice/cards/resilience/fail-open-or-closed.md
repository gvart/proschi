---
type: flip
difficulty: hard
related: [rate-limiter]
---

## Front

The rate limiter's shared counter store goes down. Should the limiter fail
open (allow) or closed (reject)?

## Back

Usually **open** for general API traffic: an outage of a protective layer
should not become a full outage, and a local per-server limit can cap the
risk meanwhile. **Closed** where abuse is the bigger danger, such as login
attempts or costly operations. Decide in advance and alert either way.
