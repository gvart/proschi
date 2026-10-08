# Tiered CDN Cache: one origin, hundreds of caches

```tldr
A flat CDN sends every edge's miss to the origin: **5k rps against a 4k-rps origin**. Add an **upper tier** between edge and origin so only **4%** of requests reach it, make that tier redundant with a **second upper-tier data center** (never a fallback to the origin), and **purge the upper tier before the edge**.
```

## What you'll learn

- Why a flat CDN multiplies origin traffic by the number of data centers, and how a second cache tier (an origin shield) fixes it.
- How hit rates compose across tiers, and how to turn them into origin load.
- Why "fall back to the origin" is the wrong failover for a cache tier, and what to do instead.
- How to purge a cache hierarchy in the right order so an old copy cannot come back.

## The problem, explained

A CDN is a network of data centers that cache your content near visitors; on a miss, a data center fetches the asset from the **origin**, your own web servers. With hundreds of data centers caching on their own, the origin sees the first request for a popular asset hundreds of times, and its owner pays the cloud for every byte it sends.

Cloudflare's Tiered Cache turns that flat network into a hierarchy. Data centers near visitors are the **lower tier** (the edge); on a miss they ask an **upper tier**, a few data centers close to the origin, and only the upper tier talks to the origin. You are designing the CDN side for one customer's site.

Two use cases:

- **Fetch asset**: a visitor requests an image or script and gets `200`. Three scenarios: `"Edge hit"` (the edge has it), `"Upper-tier hit"` (the edge misses, the upper tier has it) and `"Upper-tier miss"` (the upper tier fetches it from the origin).
- **Purge**: the site owner changes an asset and calls a purge API. By the owner's `200`, the old copy is gone from both tiers, and no edge may refill it.

Non-functional requirements: 50k requests per second, p99 under 150 ms, 99.99% availability, survival of any single machine (an upper-tier data center included), and $3,500 a month, the origin included.

**What is given.** `given.proschi` fixes the `visitor`, the `owner` and the `origin`: four servers that take 1k rps each, answer in 50 ms and cost $500 a month each. You cannot add origin servers: that is the point. A real origin is a customer's app in one cloud region, which the CDN must protect.

**What the tests check**: an edge miss asks the upper tier, and only an upper-tier miss reaches the origin; no path at all leads from the visitor or the edge to the origin; a purge clears the upper tier before the edge and never touches the origin. The requirements add latency, availability, failure survival and cost.

The model's simplifications, from the statement: each tier is one node whose replicas stand for its data centers; hit rates are the given mix, not an outcome of the topology; and traffic between your nodes is free, so the origin's egress bill (what the cloud charges for data sent out) shows up as origin load instead.

## Back-of-the-envelope

```numbers
50k rps | requests at the edge
2k rps | reach the origin, with an upper tier (4%)
50% | origin busy with an upper tier
125% | origin busy without one: saturated
15k/s | edge deletes during purges
```

Follow 50k requests a second down the hierarchy.

| Quantity | Arithmetic | Result |
|---|---|---|
| Requests at the edge | given | 50k rps |
| Edge hits | 50k × 90% | 45k rps |
| Edge misses (to the upper tier) | 50k × 10% | 5k rps |
| Upper-tier hits | 5k × 60% (= 6% of all) | 3k rps |
| Origin fetches with an upper tier | 5k × 40% (= 4% of all) | 2k rps |
| Origin fetches without one | every edge miss | 5k rps |
| Origin capacity | 4 × 1k rps | 4k rps |
| Purge fan-out | 50 purges × 300 edges | 15k deletes/s |

```callout takeaway The whole design is in two rows
**With an upper tier the origin runs at 2k ÷ 4k = 50%. Without it, at 5k ÷ 4k = 125%: saturated.** You cannot add origin servers, so the only lever is to send fewer requests there.
```

Why does an upper tier cut misses so much? A flat CDN with N data centers fetches each asset up to N times, once per cold cache; with an upper tier, the upper tier fetches it once and the edges fill from it. Cloudflare reported a 60% or greater drop in the cache miss rate from tiering, the number this problem uses.

```deepdive How the simulation sees it
At 50% utilisation the four origin servers queue a little: the 50 ms base becomes a bit over 54 ms. At 125% the node is saturated and every latency requirement of a use case that loads it fails. The upper-tier miss path is edge (5 ms) + upper tier (5 ms) + origin (about 54 ms), around 64 ms on average; because only 4% of requests take it, the use case's p99 lands well under 150 ms. The flat design's p99, with a saturated origin, is several hundred milliseconds.
```

**Cost.** The origin is $2,000 of the $3,500, leaving $1,500. A CDN replica and a service each cost $100 in the simulation's price table. CDN capacity (200k requests a second per replica) is far above what either tier sees, so replicas here are about failure, not load.

**Failure.** `survive any node failure` removes one replica of each node you run and re-runs the analysis. With one upper-tier data center, losing it breaks every edge miss, unless you add a fallback: that is where the classic mistake lives.

## Concepts

### Cache hierarchies and origin shielding

A **cache hierarchy** puts caches in layers: small caches near users, fewer bigger ones behind them, the source of truth at the end. CPUs (L1, L2, L3, RAM), browsers (memory, disk, network) and CDNs (lower and upper tiers) all do it. Commercial CDNs call the upper tier an **origin shield**: one designated location that every miss for an origin must pass through.

Why it works: miss rates multiply. If the edge misses 10% and the upper tier misses 40% of what reaches it, the origin sees 10% × 40% = 4%. The upper tier also hits far more often than any single edge, because it aggregates all edges' misses: an asset requested once in Tokyo and once in Paris is two edge misses but one upper-tier miss.

Trade-offs: an upper-tier hit adds a hop (often a long one, since the upper tier sits near the origin, not the visitor): tiering slightly slows misses to make the origin's life much easier. It also concentrates load on a few data centers, so the upper tier must be redundant. Skip tiering with one cache location, uncacheable content (personalised pages), or an origin that is itself a scalable store such as S3 that does not care about load.

````deepdive The pattern in Proschi
```proschi
title "Two cache tiers"

user   "User"       [Actor]
near   "Near Cache" [CDN] x2
shield "Shield"     [CDN] x2
source "Source"     [Service] x2

user   -> near   : HTTPS
near   -> shield : fill
shield -> source : fill

usecase "Get" {
  user -> near : GET /a.png
  alt "Near hit" {
    near --> user : 200
  } alt "Shield hit" {
    near    -> shield : GET /a.png
    shield --> near   : 200
    near   --> user   : 200
  } alt "Miss" {
    near    -> shield : GET /a.png
    shield  -> source : GET /a.png
    source --> shield : 200
    shield --> near   : 200
    near   --> user   : 200
  }
}
```
````

### Failover without stampedes

When a cache layer fails, the tempting fallback is "go straight to the source": safe for a tiny cache, dangerous for a big one. The cache existed because the source cannot take the full load; the moment it disappears, the source receives everything it was shielded from, at once. This is a **thundering herd**: many clients missing on the same thing at the same time.

The right failover keeps the shape of the hierarchy: a **second member of the same tier** (a fallback upper-tier data center in another location), not a path that skips the tier. Cloudflare's later work on Smart Tiered Cache describes exactly this: a primary and a fallback upper tier for each origin. The origin can then lock its firewall to the upper tier's addresses, which is why the tests forbid any path from the edge or the visitor to it.

Other tools in the same family: **request collapsing** (many concurrent misses for one key become one origin fetch), serving **stale content** while the origin is unreachable, and **load shedding** at the origin. Proschi models none of them directly, but the failure analysis makes the core lesson visible.

```callout pitfall
A fallback that reaches a node which cannot take the load is not a fallback.
```

```quiz
cache-stampede
```

### Purge ordering in a hierarchy

Purging means deleting cached copies after the source changes, and in a hierarchy the order matters. Purge the edge first, and an edge that gets a request between the two purges misses, asks the upper tier (which still has the old copy) and refills itself with it. The purge "succeeded" and the old asset is back.

```callout takeaway Purge from the source outward
The tier closest to the origin first, then the tiers that fill from it. Once the upper tier is clear, any edge miss falls through to the origin and gets the new asset. A purge never needs the origin itself, which already has the new version.
```

The fan-out is large: one purge must reach every edge data center. In Proschi an `x300` prefix on a step means it happens 300 times per request; load counts all 300 calls while latency counts the step once, as if they ran in parallel.

Alternatives to purging are **versioned URLs** (`app.3f9a.js`, never purged, just replaced) and short TTLs (time to live: how long a cached copy stays valid). Versioned URLs are the better default for static assets; purges are for content whose URL cannot change.

```quiz
fingerprinted-assets
```

## Designing it step by step

### 1. Scope the problem

Clarify: is the content cacheable and the same for everyone? (Yes: images and scripts.) How many edge locations? (About 300.) The origin's capacity, and can it grow? (4k rps, fixed.) How fast must a purge take effect? (Before the owner hears `200`.) Say that the fixed origin capacity drives everything.

### 2. High-level design

The starter is a flat CDN: visitor → edge → origin. Do the arithmetic from the table and show the origin saturating at 125%. The obvious alternative, more origin servers, is ruled out by the constraints, and in reality costs servers and egress that a better cache hit makes unnecessary.

The winning design adds a node with id `upper` between `edge` and `origin`: visitor → edge → upper → origin. Write the three fetch scenarios as three branches of one `alt`: the edge hit touches nothing but the edge, the upper-tier hit adds one hop, and only the upper-tier miss reaches the origin.

Then add a purge service for the owner: owner → purge API → upper tier, then edge.

### 3. Deep dive

**Redundancy at every tier.** Every node you run must survive losing one replica: for the edge and the purge API, two replicas. For the upper tier, resist the fallback-to-origin idea and give the tier a second data center. Check the analysis: no single points of failure, and the origin at the same utilisation after a failure.

**The purge.** Clear the upper tier first, then fan out to every edge with an `x300` step, then answer the owner; the flow test asks for upper before edge. The purge never calls the origin.

**Latency.** The miss path dominates p99 because of the origin's 50 ms (see the per-scenario numbers in the analysis), so keep the origin unsaturated and p99 follows. If p99 is high, check the origin's utilisation first.

**Budget.** Replicas times price, plus the $2,000 origin: the tiers are cheap next to the origin they protect.

### 4. Wrap-up

Summarise: two tiers, so 96% of requests never reach the origin; a redundant upper tier instead of an origin fallback; purges from the upper tier outward. Then what the model leaves out: real hit rates depend on topology and asset popularity, a far upper tier adds latency to misses, and request collapsing at the upper tier would cut origin load further during a cold start.

## Common mistakes

**Every edge fills from the origin** (`wrong/every-edge-fills-from-origin.proschi`). The flat CDN: no upper tier, edges go straight to the origin. It is most CDNs' default setup, and works while the origin is big enough for the number of edges; when it is not, cold caches after a deploy or a purge overload it. Here it fails three ways: "Edge misses go to the upper tier, not the origin", "Only the upper tier talks to the origin", and p99, because 5k rps saturates a 4k-rps origin.

**One upper-tier data center** (`wrong/single-upper-tier.proschi`). Everything flows correctly, but the upper tier has one replica and no fallback: when it fails, no edge miss can be filled. It fails `survive any node failure`. In production this is a single "shield POP" whose failure is a global outage for cache misses.

**Upper tier down, so go to the origin** (`wrong/upper-down-goes-to-origin.proschi`). A single upper tier with a `-x` failure scenario that falls back to the origin. It sounds resilient, but with the upper tier down the origin takes every edge miss, the very overload the tier prevents, and can no longer restrict who talks to it. It fails "Only the upper tier talks to the origin", because the design now has an edge-to-origin connection.

**Purging the edge first** (`wrong/purge-edge-first.proschi`). Same design, purge order reversed: between the two purges an edge can refill the stale copy from the upper tier, and it survives the purge. It fails "A purge clears the upper tier before the edge".

**A load balancer as the edge.** It distributes requests but caches nothing, so every request reaches whatever is behind it. Use a CDN technology such as `[Cloudflare]` for both tiers.

## In the interview

```callout interview Open with the observation that drives the design
"With hundreds of edge caches, the origin sees each asset's first request hundreds of times. I'd add a shield tier near the origin so it sees each asset roughly once."
```

Then show the hit-rate arithmetic: 10% edge misses times 40% upper-tier misses equals 4% at the origin, half of its capacity.

Expected follow-ups:

- **How do you pick the upper-tier location?** Close to the origin, by latency from candidate data centers; Cloudflare's Smart Topology picks it per origin. For an origin in several regions, one upper tier per region.
- **What happens on a cold start, such as after a deploy?** Many edges miss on the same new asset at once. Request collapsing at the upper tier makes them one origin fetch; versioned asset URLs let you pre-warm.
- **Why not purge with a short TTL instead?** A short TTL means constant revalidation traffic to the origin; purges keep long TTLs and still change content immediately. Versioned URLs avoid both for static assets.
- **How does the purge reach 300 data centers quickly?** A fan-out from a central service, or a pub/sub channel each data center subscribes to; acknowledge the owner only after all confirm (or a bounded timeout, with retries).
- **Does tiering make latency worse?** An upper-tier hit adds one hop, but is usually faster than a trip to a distant origin, and edge hits, the vast majority, are unchanged.

```quiz
cdn-helps-on-miss
```

## Further reading

- [Argo](https://blog.cloudflare.com/argo/), Cloudflare blog, 2017: the launch of Argo Tiered Cache and the reported 60% cut in cache misses.
- [Tiered Cache Smart Topology](https://blog.cloudflare.com/tiered-cache-smart-topology/), Cloudflare blog, 2021: lower and upper tiers, and choosing the single best upper-tier data center per origin.
- [Improving Smart Tiered Cache for Public Cloud Regions](https://blog.cloudflare.com/smart-tiered-cache-for-public-clouds/), Cloudflare blog: a primary and a fallback upper tier per origin, the failover this problem asks for.
- [Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/), Cloudflare docs: the available topologies (Smart, Generic, Regional, Custom) and how they differ.
- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network): push versus pull CDNs, TTLs and the disadvantages of CDNs, including stale content.
- [System Design Primer: Cache](https://github.com/donnemartin/system-design-primer#cache): the layers where caching happens and how cached data is updated.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): the chapter "Scale From Zero To Millions Of Users", which introduces CDNs and cache considerations.
