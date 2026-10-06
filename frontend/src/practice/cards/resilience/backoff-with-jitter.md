---
type: flip
difficulty: medium
decks: [sample]
tags: [queues]
related: [web-crawler]
---

## Front

Why add **jitter** to exponential backoff when clients retry?

## Back

Without jitter, every client that failed at the same moment retries at the
same moments (1 s, 2 s, 4 s…), hitting the recovering service in synchronized
waves. Random jitter spreads the retries out so the service can recover.
