---
type: flip
difficulty: easy
---

## Front

Why put a reverse proxy (such as nginx or Envoy) in front of your app servers?

## Back

It takes on the shared jobs: **TLS termination, load balancing, compression,
caching, rate limiting and buffering slow clients**, and it hides the internal
servers behind one address. The app servers only run application logic.
