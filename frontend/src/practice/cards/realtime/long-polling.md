---
type: flip
difficulty: easy
tags: [networking]
---

## Front

How does long polling work, and what does it cost compared with a WebSocket?

## Back

The client sends a request that the server **holds open** until there is
data or a timeout, then the client immediately asks again. It works through
any proxy, but every delivery costs a full HTTP request with headers, and
messages arriving between polls wait for the next request.
