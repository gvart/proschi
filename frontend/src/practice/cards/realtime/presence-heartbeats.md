---
type: flip
difficulty: medium
decks: [sample]
related: [chat]
---

## Front

How does a chat service know a user has gone offline when their phone just
loses signal (no "goodbye" is ever sent)?

## Back

**Heartbeats with a timeout**: the client pings every N seconds, and the server
keeps a last-seen time (e.g. a key with a TTL). If no heartbeat arrives within
about 2–3 intervals, the user is shown as offline.
