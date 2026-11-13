---
type: flip
difficulty: medium
tags: [storage]
related: [media-processing]
---

## Front

A thumbnail takes 50 ms of worker time to render and is viewed thousands of
times. Why store it instead of rendering it again on each CDN miss?

## Back

A derived output of an unchanged file never changes, so **generate it once,
store it keyed by file version, and serve it many times**. Rendering on each
miss puts the whole miss rate on the worker pool: at 50k views a second, a
5% miss rate is 2,500 renders a second, more work than the uploads create.
