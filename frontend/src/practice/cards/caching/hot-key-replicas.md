---
type: flip
difficulty: hard
tags: [sharding]
related: [discord-messages, social-graph-cache]
---

## Front

One cache key gets 1 million reads a second, more than a single cache node
can serve. What are the usual fixes?

## Back

**Copy the key**: store it as `key#1` … `key#N` on different nodes and read a
random copy (writes update all of them). Or add a small **in-process cache**
on each app server with a TTL of a second or so, so most reads never leave
the server. Both trade some staleness for spreading the load.
