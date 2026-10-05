---
type: flip
difficulty: medium
tags: [api-design]
---

## Front

What do you gain, and what do you give up, by terminating TLS at the load
balancer?

## Back

**Gain**: the load balancer can read HTTP and route by path or header,
certificates live in one place, and app servers skip the encryption work.
**Give up**: traffic behind the load balancer is plaintext unless you
re-encrypt it to the backends, which security rules often require.
