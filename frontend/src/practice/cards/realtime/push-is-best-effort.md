---
type: flip
difficulty: medium
tags: [queues]
related: [push-gateway, notification-fanout]
distinct-from: [push-when-offline]
---

## Front

Why should a chat app never rely on the push notification itself to carry the
message?

## Back

APNs and FCM are **best effort**: notifications can be delayed, collapsed or
dropped, and payloads are small (about 4 KB). Treat a push as a hint to "come
and sync". The app then fetches anything new from the server, which holds the
real copy.
