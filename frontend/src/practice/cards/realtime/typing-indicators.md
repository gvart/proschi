---
type: flip
difficulty: easy
---

## Front

How should "is typing…" indicators be handled differently from messages?

## Back

They are **ephemeral**: send them over the live connection only, never store
or queue them, throttle them (one event every few seconds), and let them
expire on their own. A lost typing event costs nothing; a stored one only
wastes space and delivers stale state later.
