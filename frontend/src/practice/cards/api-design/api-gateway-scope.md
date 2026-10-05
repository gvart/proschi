---
type: flip
difficulty: medium
tags: [networking]
---

## Front

What belongs in an API gateway, and what should stay out of it?

## Back

**In**: cross-cutting work done the same way for every request: routing,
authentication, rate limiting, TLS, request logging and metrics. **Out**:
business logic. A gateway full of per-service rules becomes a bottleneck that
every team must change and deploy.
