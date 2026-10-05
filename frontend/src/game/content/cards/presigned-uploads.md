---
name: Presigned uploads
rarity: uncommon
topic: storage
learn: [presigned-upload, multipart-upload]
effect: presigned
value: 0
---

## Text

Users upload files straight to object storage with a signed URL; app servers only sign it.

## Why

Streaming a large upload through an app server ties up its bandwidth and a connection for the whole transfer, for no reason: the server does nothing with the bytes. A presigned URL lets the client send them to object storage directly, with permission for exactly one object for a few minutes.
