---
title: Tiered CDN Cache
summary: "Cloudflare's Tiered Cache: edge misses fill from an upper tier, not the origin."
difficulty: medium
company: Cloudflare
tags: [caching, cdn, availability, real-world]
hints:
  - "Every edge data center caches on its own, so a popular asset is fetched from the origin once per data center. What if a data center that misses asked another data center first?"
  - "Put a second tier of data centers (id upper) between the edge and the origin. An edge miss asks the upper tier; only an upper-tier miss reaches the origin. With the given mix, the upper tier answers 6% of all requests and only 4% reach the origin."
  - "No connection from the edge or the visitor to the origin, not even as a fallback: when the upper tier is down, the origin would take every edge miss at once. Give the upper tier a second data center instead (x2)."
  - "\"Purge\" clears the upper tier first, then every edge data center (a fan-out such as x300): an edge that missed in between would otherwise refill the old asset from the upper tier. The purge never touches the origin."
---

A CDN data center that does not have an asset asks the origin for it. With
hundreds of data centers, each with its own cache, the origin sees the
first request for a popular asset hundreds of times over, and its owner
pays the cloud for every byte it sends out.

Cloudflare's Tiered Cache turns the flat network into a hierarchy. The data
centers near visitors are the **lower tier** (the edge). When they miss,
they ask an **upper tier**, a few data centers close to the origin, and only
the upper tier asks the origin. Smart Tiered Cache picks the upper-tier data
center for each origin and keeps a fallback in another location. Cloudflare
says Tiered Cache cuts the cache miss rate by 60% or more.

Design the CDN side for one customer's site.

## Functional requirements

- **Fetch asset**: a visitor requests a cacheable asset (an image, a script)
  and gets `200`. Three scenarios:
  - `"Edge hit"`: the visitor's edge data center has it.
  - `"Upper-tier hit"`: the edge misses, and the upper tier has it.
  - `"Upper-tier miss"`: neither has it, and the upper tier fetches it from
    the origin.
- **Purge**: the site owner changes an asset and purges it through an API.
  The old copy must be gone from both tiers when the owner hears `200`, and
  no edge may refill the old copy afterwards.

Name the two tiers `edge` and `upper`: the tests in `problem.proschi` refer
to them, and to the use case and scenario names above.

## Scale

- **50k requests per second** for the site at peak; 90% are edge hits.
- Of the 10% that miss the edge, the upper tier answers **60%**, the cut in
  misses Cloudflare reports: 6% of requests are upper-tier hits, 4% go to the
  origin.
- About **50 purges per second**, each reaching some **300** edge data
  centers.

## Constraints

- The origin has **4 servers** that take **1k requests per second** each and
  answer in **50 ms**. You cannot add more.
- Only the upper tier talks to the origin: no connection from the edge or
  the visitor to it, so the origin can allow just the upper tier's
  addresses.
- p99 of **Fetch asset** under **150 ms**, available **99.99%** of the time.
- Losing any single machine, an upper-tier data center included, must not
  break a latency limit or overload the origin.
- At most **$3,500 / month**, the origin included.

## What is given

`problem.proschi` declares the `visitor`, the `owner` and the `origin`, and
holds the traffic, requirements and tests. Add the two tiers, the purge
API, the connections and the two use cases.

The simulation is simpler than the real network: each tier is one node whose
replicas stand for its data centers, the hit rates are the given mix rather
than a result of the topology, and traffic between your own nodes is free,
so the origin's egress bill shows up as load on the origin instead.

## Based on

- [Argo](https://blog.cloudflare.com/argo/), Cloudflare blog, May 2017:
  Argo Tiered Cache, which asks other Cloudflare data centers before the
  origin, and the 60% reduction in the cache miss rate.
- [Tiered Cache Smart Topology](https://blog.cloudflare.com/tiered-cache-smart-topology/),
  Cloudflare blog, February 2021: lower and upper tiers, and the single best
  upper-tier data center chosen for each origin to raise the hit ratio and
  lower origin load.
- [Improving Smart Tiered Cache for Public Cloud Regions](https://blog.cloudflare.com/smart-tiered-cache-for-public-clouds/),
  Cloudflare blog, 2026: a primary and a fallback upper tier for each origin,
  and funnelling every miss through one location close to the origin.
- [Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/),
  Cloudflare docs: the topologies (Smart, Generic, Regional, Custom).
