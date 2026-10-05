---
type: flip
difficulty: medium
tags: [realtime]
---

## Front

When would you pick **least connections** over round robin for a load
balancer?

## Back

When requests differ a lot in how long they take, or connections are
long-lived (WebSockets, streaming). Round robin hands out equal counts, so a
server stuck with slow work keeps getting more; least connections sends new
work to the server that is least busy now.
