---
type: choice
difficulty: medium
tags: [resilience]
distinct-from: [backoff-with-jitter]
---

## Question

A gateway holding a million WebSocket connections restarts. How do you keep
the reconnects from overwhelming the other servers?

## Options

- [ ] Clients reconnect immediately, as fast as possible
- [x] Clients reconnect after a random delay that grows with each failed attempt
- [ ] The server sends every client a new address by email
- [ ] Clients stay disconnected until the user reopens the app

## Why

A million clients reconnecting in the same second is a self-inflicted DDoS.
Random jitter spreads them over many seconds. Deploys should also drain
servers gradually instead of dropping all connections at once.
