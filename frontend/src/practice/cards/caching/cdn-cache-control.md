---
type: choice
difficulty: medium
tags: [networking]
---

## Question

You want CDNs to cache a page for a day but browsers for only a minute. Which
header does that?

## Options

- [x] `Cache-Control: public, max-age=60, s-maxage=86400`
- [ ] `Cache-Control: private, max-age=86400`
- [ ] `Cache-Control: no-store`
- [ ] `Cache-Control: no-cache, max-age=86400`

## Why

`s-maxage` applies only to shared caches such as CDNs and overrides `max-age`
there. `private` forbids shared caches, `no-store` forbids all caching, and
`no-cache` makes every cache revalidate before each use.
