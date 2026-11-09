---
type: flip
difficulty: medium
tags: [estimation]
related: [media-processing]
---

## Front

Thumbnails take 50 ms each and document previews 500 ms. Why give each
transformation its own worker pool behind the queue?

## Back

Each pool is **sized and scaled from its own rate and cost per job**, and a
backlog of slow previews cannot delay cheap thumbnails. In one shared pool,
thumbnails wait behind document conversions, and no single size fits both
loads.
