---
title: Nearby Search
summary: "Tinder's geosharded search: S2 cells grouped by load, so a search reads only the few geoshards near it."
difficulty: hard
company: Tinder
tags: [geo, sharding, search, hot-partitions, real-world]
version: 2
strict: true
hints:
  - "A search only wants people within the searcher's radius. If the index is sharded by user id, how many shards does every search have to visit, and what does each shard then serve?"
  - "Shard by location: cover the map with S2 cells, group nearby cells into geoshards, and let a geo router turn the search circle into the few geoshards it overlaps. In the model a search visits 3 geoshards (x3), all in one group: `metro` for a dense metro, `regional` for everywhere else."
  - "Equal-area geoshards put a whole city in one geoshard. Balance by load instead: the metros take 40% of the searches on a sliver of the land, so `metro` gets its own shards (capacity { metro shards 3 }) and every geoshard keeps replicas."
  - "A location update writes `profiles`, publishes to a stream and answers; an indexer upserts the user in the geoshard that owns the new cell, and in \"Moved geoshard\" deletes them from the old one first. Losing a node takes one copy of one geoshard, and its load falls on the copies left: with two copies it doubles. Size each group so a geoshard stays under about 70% busy after a loss."
---

Tinder shows each user a stack of people nearby: within the distance they
chose (at most 100 miles), matching their filters. Everyone searchable
lives in Elasticsearch. At first that was one cluster with one index and the
default five shards, scaled with more replicas and bigger nodes until CPU
and cost were too high: every search worked through users on other
continents only to filter them out.

Tinder's fix was to shard the index by location. The map is divided into
**S2 cells** (Google's hierarchical cells on the sphere). Nearby cells are
grouped into **geoshards**, and the grouping balances **load**, not area: a
dense metro is split into several small geoshards, while a sparse region
far bigger shares one. A search turns its circle into the cells that cover
it and reads only the few geoshards those cells belong to. Design the
search, the router in front of the geoshards, and the path that keeps the
index up to date as people move.

## Functional requirements

- **Recommend**: a user opens the app and asks for people within their
  radius. The request goes to a **geo router** (name it `router`) that covers
  the circle with S2 cells, maps them to geoshards, searches each one,
  filters by age and merges the candidates. Two scenarios, by where the
  searcher is:
  - `"Dense metro"`: the circle lies in a dense metro; it covers 3 of the
    **metro geoshards** (name that group `metro`).
  - `"Elsewhere"`: the circle lies anywhere else; it covers 3 of the
    **regional geoshards** (name that group `regional`).
- **Update location**: the app reports where the user is. The location is
  saved in `profiles` before the app hears back, and a change event goes to
  a stream. The update never waits for the index.
- **Index location**: an indexer consumes the change and updates the
  geoshard that owns the user's new S2 cell. Three scenarios:
  - `"Dense metro"`: the user stays in a metro geoshard; one upsert there.
  - `"Elsewhere"`: the user stays in a regional geoshard; one upsert there.
  - `"Moved geoshard"`: the new cell belongs to another geoshard (in the
    model, a user arriving in a metro from elsewhere): delete the user from
    the old regional geoshard, then upsert them into the new metro one.

Use these ids, use case and scenario names exactly: the traffic,
requirements and tests in `problem.proschi` refer to them.

## Scale

- **6k searches a second** at peak, **40%** of them from dense metros that
  cover well under 1% of the land.
- **3k location updates a second**, each indexed once; **5%** of them move
  the user to another geoshard.
- A search circle covers about **3 geoshards**.
- The searchable index needs at least **7 geoshards** to hold it.
- An Elasticsearch node serves about **3k requests a second**.

Tinder's posts report 40 to 100 geoshards worldwide and an example where a
100-mile search reads 3 of 55 geoshards. The rates, the 40% share, the 5% of
moves and the 7 geoshards here are assumptions for the exercise.

## Constraints

- Searches never read `profiles`, and no client connects to the index.
- p99 of a search under **150 ms**, of a location update under **80 ms**.
- Searches and location updates available **99.9%** of the time.
- Every geoshard has at least two copies; losing any single machine must
  not break a latency limit.
- At most **$13,500 / month**, `profiles` included.

## What is given

`problem.proschi` declares the client, `app`, and `profiles`, the source
of truth for profiles and locations (DynamoDB, x3). Add the API, the geo
router, the two geoshard groups (Elasticsearch; their shard counts, with
`capacity { metro shards 3 }`, are yours to choose), the change stream,
the indexer and the three use cases.

## What this model leaves out

- **Skew inside one node.** The simulation spreads a node's load evenly
  over its shards and replicas, so it cannot see one hot geoshard. The
  problem draws the dense metros as their own group, `metro`, so the cost
  of sizing geoshards by area instead of load shows up as that group's
  load.
- **Building the geoshards.** Choosing the S2 level, scoring each cell's
  load and grouping cells into balanced geoshards is offline work done
  before any request. It is described in the lesson, not simulated.
- **Circles on a boundary.** A search near the edge of a metro covers
  geoshards of both groups. The scenarios keep each search in one group.
- **Time zones.** Each region peaks at its own local evening, and Tinder saw
  more than 10× difference in requests a second between geoshards. It spreads
  the primaries and replicas of the geoshards randomly over the data nodes,
  about four indexes per node, so the peaks even out; the simulation has one
  steady peak.
- **Consistency of a move.** A delete and an upsert on two indexes are not
  atomic, and two quick moves can arrive out of order. Partitioning the
  stream by user id keeps one user's changes in order; the simulation has
  no reordering or crashes in the middle of a request.

## Based on

The series lists Frank Ren, Xiaohu Li, Devin Thomson and Daniel Geng as
authors.

- Frank Ren, [Geosharded Recommendations Part 1: Sharding Approach](https://medium.com/tinder/geosharded-recommendations-part-1-sharding-approach-d5d54e0ec77a),
  Tinder Tech Blog, May 14, 2019: one Elasticsearch cluster and index with
  the default five shards, scaled with replicas and bigger nodes until CPU
  and cost were too high; searches capped at 100 miles; an equal
  latitude-longitude grid giving hot and empty shards; a load score per cell
  from unique users, active users or queries an hour, and balance measured
  as the standard deviation of the scores; Google's S2 cells (levels 7 and
  8) grouped by load, so low-load geoshards are large and dense cities like
  New York and London small; 40 to 100 geoshards worldwide, since geoshards
  that are too small make each search read many and hurt the P99; a 100-mile
  search reading 3 of 55 geoshards in their example; a user crossing a
  boundary moved to the new index and removed from the old, not atomically;
  and a geosharded index handling 20× the computation of the single one.
- Xiaohu Li, [Geosharded Recommendations Part 2: Architecture](https://medium.com/tinder/geosharded-recommendations-part-2-architecture-3396a8a7efb),
  Tinder Tech Blog, May 29, 2019: an abstraction layer, an internal
  microservice, that works out the geoshards from the location and distance
  filter, queries them and aggregates; location changes going through the
  profile and location services, which decide on a shard move; one index per
  geoshard in one cluster rather than many clusters; replicas added to a hot
  geoshard; and primaries and replicas spread randomly over the data nodes,
  because geoshards in different time zones peak at different times.
- Devin Thomson, [Geosharded Recommendations Part 3: Consistency](https://medium.com/tinder/geosharded-recommendations-part-3-consistency-2d2cb2f0594b),
  Tinder Tech Blog, August 14, 2019: Kafka partitions keyed by document so
  one user's writes stay in order; a move done as a fetch of the document
  and an index into the new geoshard; retries with exponential backoff and
  jitter by asynchronous workers; and refeeding from the source of truth.
