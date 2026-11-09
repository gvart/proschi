# Nearby search: geoshards balanced by load

```tldr
Shard a nearby-people index **by location**, not by user id: cover the map with **S2 cells**, group neighbouring cells into **geoshards of equal load** (a dense city becomes several small geoshards, a sparse region shares one), and let a **geo router** send each search only to the few geoshards its circle covers. Keep a **replica of every geoshard**, and move users between geoshards **from a stream** keyed by user id.
```

## What you'll learn

- Why sharding a search index by user id makes every query visit every shard, and why that means more shards add no query capacity.
- How **S2 cells** turn "everyone within 50 miles" into a short list of cell ids.
- Why geoshards must be balanced by **load** rather than by area, and how a dense city becomes several geoshards.
- What a **geo router** does: cover the circle, map cells to geoshards, fan out to a few and merge.
- How a location update reaches the index, and what has to happen when a user moves to another geoshard.

## The problem, explained

A dating app shows each user people nearby: within the distance they chose, filtered by age and other preferences. The candidates come from a search index of every active user, with their location and the fields the filters need. The profile store stays the source of truth; the index is a copy built for this one question.

Tinder first kept that index in one Elasticsearch cluster with one index and the default five shards, and scaled it with more replicas and bigger nodes until CPU and cost were too high. Every search had to work through users across the whole world to keep the few within the radius (at most 100 miles). Their engineering blog describes the fix: shard the index by location into **geoshards**, built from S2 cells and balanced by load, so that a search reads only the geoshards near the searcher.

The problem has three use cases:

- **Recommend**: the app asks the API, the API asks the geo router (`router`), and the router searches 3 geoshards. In `"Dense metro"` they belong to the `metro` group, in `"Elsewhere"` to the `regional` group.
- **Update location**: the app's new location is written to `profiles`, a change event goes to a stream, and the app hears back.
- **Index location**: an indexer consumes the event and upserts the user in the geoshard that owns their new cell; in `"Moved geoshard"` it first deletes them from the old one.

The tests check that searches go through the router and never read `profiles`, that a search stays inside one group, that location updates never call the index, that a move touches both the old and the new geoshard, and that every geoshard has a replica.

## Back-of-the-envelope

```numbers
6k / s | searches
18k / s | geoshard searches, at 3 per search
3k / s | location updates
21 nodes | 7 geoshards × 3 copies
$12,300 | a month for the reference design
```

Tinder's posts give 40 to 100 geoshards worldwide and an example where a 100-mile search reads 3 of 55; the rates, the 40% metro share and the 7 geoshards here are assumptions for the exercise.

| Flow | Rate | Where it lands |
|---|---|---|
| Recommend, dense metro | 2.4k/s | 7.2k geoshard searches/s on `metro` |
| Recommend, elsewhere | 3.6k/s | 10.8k geoshard searches/s on `regional` |
| Update location | 3k/s | API, `profiles` (writes), the stream |
| Index location | 3k/s | indexer; 1.35k writes/s on `metro`, 1.8k on `regional` |

**The metro group.** 7.2k searches and 1.35k writes a second is 8.55k requests. At about 3k a node, that is under 3 nodes of pure work. Three geoshards with three copies each is 9 nodes at about 32% busy. Lose one copy and that geoshard's 2.85k a second falls on two nodes: about 48%.

**The regional group.** 10.8k searches and 1.8k writes is 12.6k requests. Four geoshards of three copies is 12 nodes at 35%, and 53% after a loss.

**Sharded by user id instead.** Every search must visit all 7 shards, so each shard serves all 6k searches a second, whatever the shard count. Two copies would be 100% busy before a single write; four copies of 7 shards is 28 nodes, $11,200 for the index alone, and the budget is gone.

**The rest.** The API takes 9k requests a second at 2k per instance: 8 instances at 56%. The router takes 6k: 6 instances at 50%. The indexer handles 3k: 4 instances at 38%.

## Concepts

### Search the index, not the database

"Everyone within 50 miles, aged 25 to 35" is a range query over two coordinates plus filters. A key-value profile store is built to fetch a user by id; asked for a box of latitudes and longitudes it can only scan, and every scan competes with the location writes on the source of truth.

So the searchable fields live twice: in `profiles` as the truth, and in a search index built for location and filter queries. The index is allowed to lag by a second or two; a profile shown a moment after its owner moved is harmless.

```quiz
inverted-index
oltp-vs-olap
```

### Why one big index stops scaling

An index too big for one node is split into shards. The question is which field decides the shard. The usual default, a hash of the user id, spreads users evenly, and that is exactly the problem: neighbours end up on every shard, so a search for "near me" has to ask every shard and merge the answers. This is **scatter-gather**.

Scatter-gather has two costs. Each shard serves every search, so adding shards adds work per search, never capacity; only more copies of each shard help. And the search waits for the slowest of all the shards, so its tail latency grows with the shard count.

The way out is to shard by the field the query filters on. Searches filter on location, so the index should be split by location.

```callout takeaway
Shard by what the query filters on. A search that can name its shards reads a few; one that cannot reads them all.
```

```quiz
scatter-gather
nearby-search-shards-per-search
fan-out-tail-latency
```

### S2 cells

To shard by location, you need a way to name a piece of the map. Google's **S2** library projects the sphere onto the six faces of a cube and divides each face into a hierarchy of cells: each cell splits into four children, through 31 levels (0 to 30), from a whole face down to about a square centimetre. Every cell has a 64-bit id, and the ids follow a Hilbert curve, so cells that are close on the map are usually close in id order.

S2 gives two operations a nearby search needs. One maps a point to the cell that contains it, at any level: that is where a user is indexed. The other **covers a region**: given a circle around the searcher, it returns a small set of cells that together contain it. Cells at the same level have roughly the same area anywhere on Earth, unlike a latitude-longitude grid, whose cells shrink towards the poles.

```deepdive S2 or geohash?
A geohash also names cells with a string whose prefix gets shorter as the cell grows, and it works as a plain database key. Its cells are rectangles in latitude and longitude, so their size changes with latitude, and its curve jumps more at cell edges. S2's cells are close to equal area and its covering function returns a tight set of cells for a circle. For this problem either names cells; what matters is the next step, grouping cells into geoshards.
```

```quiz
geohash-neighbours
quadtree-vs-geohash
```

### Geoshards balanced by load

The simplest way to cut the map is into equal pieces: every geoshard the same number of cells. It fails on the first city. Users are packed into metros, and so are searches, so the geoshard over a big city gets a large share of the whole load while geoshards over oceans and deserts sit idle. That is a hot shard, and adding nodes to the cluster does not cool it.

Tinder groups cells by **load** instead. Each cell (S2 level 7 or 8) gets a score from its unique users, active users, queries an hour or a mix of them, balance is measured as the standard deviation of the geoshards' scores, and neighbouring cells are added to a geoshard until it holds its share of the total. A dense metro ends up as several small geoshards, and a sparse region much larger than it shares one. The cells stay contiguous, so a search circle still falls into a few geoshards. The grouping is computed ahead of time, not per search, and is redone when the map of load shifts.

In this problem the dense metros are their own group, `metro`, because the simulation spreads a node's load evenly over its shards and cannot see one hot geoshard inside a group. The metros take 40% of the searches on well under 1% of the land. Equal-area thinking gives them one geoshard; load balancing gives them three of the seven.

```callout pitfall
Balanced by area means unbalanced by load. A hot geoshard is the hot partition of a location index.
```

```quiz
nearby-search-balance-by-load
hot-partition-key
```

### Routing a search to its geoshards

The **geo router** sits between the API and the index. For each search it covers the circle with S2 cells, looks up each cell's geoshard in a small map that every router instance keeps in memory, sends the search to those geoshards in parallel, and merges what comes back. Tinder's posts call this an abstraction layer; it also hides the geoshard layout, so the layout can change without touching the recommendation service.

A search near the middle of a large regional geoshard may read only one; one in a metro, where geoshards are small, reads several. Geoshards that are too small would make every search read many and hurt the P99, which is why Tinder kept 40 to 100 worldwide; in their example a 100-mile search reads 3 of 55. The problem assumes about 3 per search. That is the whole gain: 3 geoshard searches instead of 7 shard searches, and each geoshard holds only nearby users, so each search scans less.

```quiz
geo-partitioning
```

### Replicas per geoshard

A geoshard lives on a primary and its replicas. Replicas are full copies that answer searches for the geoshard and take over when a node dies. They also cost writes, since every copy applies every location change.

Replicas can follow load too: Tinder scales a hot geoshard by adding replicas, and spreads the primaries and replicas randomly over the data nodes (about four indexes per node), because geoshards in different time zones peak at different times, more than 10× apart in requests a second. One geoshard's evening peak in New York then shares a node with another's quiet night elsewhere. Here every geoshard gets three copies, so losing one leaves two to share its load.

```quiz
search-indexing-shards-vs-replicas
three-replicas-parallel
```

### Keeping the index in step with moves

A location update has one job on the request path: save the location in `profiles` and answer. The index follows from a stream. The API publishes a change event; an indexer consumes it, computes the user's new cell and geoshard, and upserts the user there. A busy geoshard then slows only the indexer, never the app.

Moves are the interesting case. When the new cell belongs to another geoshard, the indexer must **delete the user from the old geoshard and insert them into the new one**: two writes on two indexes, not atomic. Two quick moves applied out of order could put the user back where they were, or in two geoshards at once. Keying the stream by user id puts all of one user's changes in one partition, read in order by one consumer; Tinder keys its Kafka partitions this way because a Passport move can follow another within milliseconds. Failed writes are retried with exponential backoff and jitter, and refeeding from `profiles` repairs whatever still slips through.

```quiz
nearby-search-move-between-geoshards
change-data-capture
transactional-outbox
```

## Designing it step by step

1. **The search path.** Add the API and the geo router. The app calls the API, the API calls the router, and nothing on this path reads `profiles`.
2. **The geoshards.** Add two Elasticsearch groups, `metro` and `regional`. Choose their shard counts so the metro group gets geoshards in proportion to its load, not its area, and give every geoshard at least two copies.
3. **The fan-out.** In `"Dense metro"` the router searches 3 metro geoshards (`x3`), in `"Elsewhere"` 3 regional ones, and merges the candidates.
4. **The location update.** The API writes `profiles`, publishes a change event to a Kafka topic keyed by user id, and answers.
5. **The indexer.** Consume the stream and upsert the user in the geoshard that owns their cell; in `"Moved geoshard"`, delete them from the old geoshard first.
6. **Size it.** Count each group's searches and writes, divide by about 3k per node, and check each geoshard's copies stay well under 70% with one of them gone. The index is about two thirds of the budget.
7. **Explain the trade-offs** in `decision` blocks: why location, why load and not area, why a router, why a stream.

## Common mistakes

- **Sharding by user id.** Every search visits all 7 shards, each shard serves every search, and the index needs four copies of everything to keep up. It fails *A search visits only the geoshards around the searcher* and the budget.
- **Geoshards of equal area.** The metros get one geoshard because they are small on the map. It takes 40% of the searches and saturates, so searches there slow past the limit. It fails *p99 of Recommend < 150 ms*.
- **Searching the profile database.** The API scans `profiles` for a box of coordinates. It fails *Searches go through the geo router*: the source of truth is for writes, the index for searches.
- **Indexing inside the update.** The API writes `profiles`, then deletes and inserts in the geoshards before it answers. The app waits for Elasticsearch, and a half-done move has nobody to retry it. It fails *Location updates reach the geoshards through the stream* and the update's latency limit.

## In the interview

- **Name the query first.** "Everyone within R of a point, filtered" decides the shard key; say so before drawing shards.
- **Expect "what about New York?"** That is the hot-spot question. Answer with load-balanced geoshards: smaller geoshards where users are dense, more copies where searches are heavy.
- **Expect "what if the radius is huge?"** A wide circle covers more cells and more geoshards; the router caps the fan-out or widens the cell level, and a remote area's geoshard is large anyway.
- **Expect "what happens when someone travels?"** Delete from the old geoshard, insert into the new, in order per user through a keyed stream, with a background resync.
- **Expect "how do you rebalance?"** Recompute cell scores, regroup cells into new geoshards, build the new indexes alongside the old ones and switch the router's map once they have caught up.

## Further reading

- Frank Ren, [Geosharded Recommendations Part 1: Sharding Approach](https://medium.com/tinder/geosharded-recommendations-part-1-sharding-approach-d5d54e0ec77a) (May 14, 2019); Xiaohu Li, [Part 2: Architecture](https://medium.com/tinder/geosharded-recommendations-part-2-architecture-3396a8a7efb) (May 29, 2019); Devin Thomson, [Part 3: Consistency](https://medium.com/tinder/geosharded-recommendations-part-3-consistency-2d2cb2f0594b) (August 14, 2019); Tinder Tech Blog: the system this problem is based on.
- ByteByteGo, [How Tinder Recommends to 75 Million Users with Geosharding](https://blog.bytebytego.com/p/how-tinder-recommends-to-75-million): a secondary summary of the three posts (the user count is ByteByteGo's, not from the posts).
- S2 Geometry, [S2 Cells](https://s2geometry.io/devguide/s2cell_hierarchy) and [the S2 overview](https://s2geometry.io/about/overview): the cell hierarchy, cell ids and region covering.
- Elastic, [Scalability and resilience: clusters, nodes and shards](https://www.elastic.co/guide/en/elasticsearch/reference/current/scalability.html): primaries, replicas and how a search uses them.
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 6, "Partitioning" (the sections on partitioning secondary indexes and skewed workloads).
