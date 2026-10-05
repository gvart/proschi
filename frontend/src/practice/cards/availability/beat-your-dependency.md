---
type: flip
difficulty: medium
tags: [resilience]
related: [payments, notification-fanout]
---

## Front

Your service calls a provider that is only 99% available. How can your
service be more available than it?

## Back

Do not need it on every request: serve the **last good value from a cache**,
fail over to a **second provider**, or **accept the work and queue it**, so it
finishes when the provider is back. Without such a fallback, your
availability can never exceed the provider's.
