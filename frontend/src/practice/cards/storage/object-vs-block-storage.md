---
type: flip
difficulty: easy
decks: [sample]
related: [file-storage, video-streaming]
---

## Front

Where do you store user-uploaded photos and videos, and why not on the app
servers' disks?

## Back

In **object storage** (S3, GCS): whole files by key over HTTP, with effectively
unlimited capacity, built-in durability and cheap per-GB pricing, served
through a CDN. Local disks are tied to one server, are lost with it and do not
scale out.
