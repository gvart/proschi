---
type: flip
difficulty: medium
tags: [networking]
---

## Front

When would you pick gRPC over REST with JSON?

## Back

For **internal service-to-service** calls: compact binary Protobuf, HTTP/2
streaming, and generated, typed clients from one schema. Keep REST for
**public and browser** APIs, where JSON is easy to read, HTTP caching works,
and browsers cannot call gRPC without a proxy.
