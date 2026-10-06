---
name: Edge functions
icon: earth-lock
rarity: uncommon
topic: caching
learn: [cdn-cache-control]
effect: edge-hit
value: 0.1
downside: cost
downside-target: cdn
downside-value: 1.6
---

## Text

CDNs answer 10 points more requests at the edge. But the CDN costs 60% more: code runs on every request it serves.

## Why

Running a little code at the edge (personalising a cached page, checking a token) lets the CDN answer requests that used to need your servers. Edge compute is billed per request and per millisecond, so it is dearer than serving a static file.
