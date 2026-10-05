---
type: flip
difficulty: easy
related: [notification-fanout]
---

## Front

Password-reset emails wait behind a 10-million-message newsletter in the same
queue. How do you fix it?

## Back

Use **separate queues per priority** with their own consumers (or weighted
polling that favours urgent ones), so bulk work cannot delay urgent work. A
single queue is first in, first out, whatever the message's importance.
