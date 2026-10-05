---
type: choice
difficulty: easy
tags: [caching]
related: [video-streaming]
---

## Question

Why do HLS video segments cache so well on a CDN?

## Options

- [x] Each segment is a small, immutable file that is identical for every viewer
- [ ] Segments are encrypted per viewer
- [ ] Segments are generated live for each request
- [ ] CDNs store whole movies in one object

## Why

A segment never changes once written, so it can be cached for a long time
with no invalidation. Every viewer of a popular video asks for the same files,
so the edge serves almost all of them.
