---
type: flip
difficulty: hard
tags: [availability]
---

## Front

GeoDNS answers each lookup with the address of the nearest region. What are
its limits?

## Back

It sees the **resolver's** location, not the user's (unless the resolver
passes the client subnet), so a user on a distant public resolver can be sent
to the wrong region. Answers are **cached for the TTL**, so moving users away
from a failed region takes at least that long.
