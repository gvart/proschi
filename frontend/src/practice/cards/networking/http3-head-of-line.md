---
type: choice
difficulty: hard
---

## Question

Which problem does HTTP/3 (over QUIC) fix that HTTP/2 still has?

## Options

- [ ] Only one request at a time per connection
- [ ] No compression of headers
- [x] One lost packet stalls every stream on the connection (TCP head-of-line blocking)
- [ ] Traffic is not encrypted by default

## Why

HTTP/2 multiplexes many streams over one TCP connection, but TCP delivers
bytes in order, so a lost packet blocks all of them until it is resent. QUIC
runs over UDP with independent streams. HTTP/1.1 had the one-request limit,
and HTTP/2 already compresses headers.
