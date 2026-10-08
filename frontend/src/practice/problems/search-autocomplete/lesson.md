# Search Autocomplete: answering every keystroke without searching

```tldr
Autocomplete is a **precomputation** problem, not a search problem. Rebuild the **top ten per prefix** every 15 minutes from a query log, serve it with one `GET` from **Redis**, and put a **CDN** in front that answers 80% of keystrokes. Searches append to the log **asynchronously** (`->>`), so logging never slows them down.
```

## What you'll learn

- Why autocomplete is a *precomputation* problem, not a search problem, and how a trie with cached top-k lists turns a prefix into one key lookup.
- How a CDN in front of an API absorbs most of a read-heavy workload, and how to size the servers behind it for the misses only.
- How to keep logging and counting off the request path with a queue and a scheduled batch job.
- How to turn a requirement like "p99 under 50 ms at 100k rps" into replica counts and a budget check.

## The problem, explained

You are building the suggestion box of a shop's search bar. The user types `i`, `ip`, `iph`, `ipho`, and after each keystroke the box shows the ten most popular completions: *iphone 15*, *iphone case*, *iphone charger*. Every keystroke is a request, so suggestions are by far the most frequent call, and they must feel instant: a list that arrives after the next letter is useless.

There are three use cases:

- **Suggest**: `GET /suggest?q=<prefix>` returns the top ten completions. In `"Edge hit"` the CDN already holds the answer and replies itself. In `"Edge miss"` the CDN forwards the request to your servers, which read the precomputed top ten from an in-memory store.
- **Search**: the user submits a full query and gets results from the existing search cluster. Every query is also appended to a query log (tomorrow's suggestions are learned from today's searches), and logging must never slow a search down.
- **Rebuild index**: every 15 minutes a scheduler starts a batch job that reads recent queries from the log, counts them per prefix and writes each prefix's new top ten into the suggestion store.

The non-functional requirements: 100k suggestion requests per second at peak, a p99 under 50 ms (99% of requests finish within 50 ms), 99.95% availability, survival of any single machine failure, and a hard budget of $5,500 a month.

**What is given.** `given.proschi` fixes the `user`, the existing `search` cluster (three Elasticsearch nodes, about 9k rps in the simulation, sized for searches, not keystrokes) and the `scheduler` (an EventBridge rule) that kicks off the rebuild. You design around them.

**What the tests check**, in plain words:

- Suggestions never touch the search cluster or any database: a prefix lookup must not be a search.
- Suggestions go to a real CDN first and only then to a cache. The hit scenario never reaches a service; the miss scenario reads the cache.
- A search calls the search cluster and writes to a queue, but never waits for the queue before answering.
- The rebuild starts at the scheduler, reads the queue before writing the cache, and never queries the search cluster.

The requirements add p99, availability, failure survival and cost.

## Back-of-the-envelope

```numbers
100k rps | suggestion requests at peak
80k rps | answered at the edge
20k rps | edge misses reaching your servers
50 : 1 | reads per write on the user side
34+ nodes | to serve keystrokes from search
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Suggestion requests | given | 100k rps |
| Answered at the edge | 100k × 80% | 80k rps |
| Edge misses reaching your servers | 100k × 20% | 20k rps |
| Searches (and query-log writes) | given | 2k rps |
| Read:write ratio on the user side | 100k : 2k | 50 : 1 |
| Suggestion data | 5M prefixes × 10 completions × ~30 bytes | ~1.5 GB raw, "a few GB" with overhead |
| Search cluster capacity | 3 nodes × 3k rps | 9k rps |
| Search nodes needed to serve keystrokes there | 100k ÷ 3k | 34+ nodes, before any headroom |

**The search cluster is out.** Serving keystrokes from Elasticsearch needs over 30 search nodes at 100% utilisation: at $400 a node, about $13,600 a month, more than twice the budget.

**The data fits in memory.** A Redis replica takes about 100k operations a second in the simulation, so the 20k edge misses use a fifth of one. Two replicas are for failure, not load.

**The servers behind the CDN are sized for 20k rps, not 100k.** A service replica handles about 2k rps, so the Suggest Service needs at least 10 replicas just to avoid saturation, and more to keep queueing small.

````deepdive How the simulation sees it
Utilisation is load ÷ (replicas × per-replica capacity). Latency is base latency plus M/M/c queueing delay: a pool at 50% barely queues, at 90% it roughly triples. An idle hop's p99 is about 2.8× its mean.

The miss path is CDN (5 ms) + load balancer (2 ms) + service (10 ms) + Redis (1 ms): about 18 ms of base latency, so its own p99 is already near 50 ms. The use case's p99 mixes 80% hits with 20% misses, which pulls it well below that, but only if the service is not queueing. Keep the service about half busy, as the hints suggest.
````

**Budget.** The search cluster ($1,200) and scheduler ($200) leave about $4,100. Services cost $100 per replica, Redis $150, a CDN replica $100, Kafka $200. Without the CDN, 100k rps at a sane utilisation needs about 100 service replicas: $10,000 for one tier.

**Availability.** A node is up when any replica is, so two replicas of everything on the suggestion path clear 99.95%; one replica is a single point of failure and fails `survive any node failure`.

## Concepts

### Tries and precomputed top-k lists

A **trie** (prefix tree) stores strings by their characters: the root has a child per first letter, each child a child per second letter, and so on. Every node is a prefix, so finding all strings starting with `ipho` means walking four edges, then visiting the subtree below.

That subtree is the problem: under `i` there may be millions of queries, far too many to collect and sort on every keystroke. The classic fix is to **store the answer at each node**: its own top k completions, ranked by frequency. A lookup becomes "walk to the node, return its list"; flatten the trie into a key-value map (`top10:ipho -> [...]`) and it is a single `GET`.

It works because rankings change slowly: this hour's top completions of `ipho` look like last hour's, so you can recompute them in a batch and serve them read-only. The trade-off is **freshness**: a suddenly trending query waits for the next rebuild. You also spend memory on k completions per prefix, which is why real systems cap prefix length and drop rare prefixes.

```callout pitfall When a trie is the wrong tool
Results that depend on the user (a personal contact list, "people you may know"), a corpus that changes every second and must appear immediately, or fuzzy and out-of-order matching (`case iph` should find *iphone case*). Then you need a real search engine, an inverted index or a per-user index, and you pay for it in latency and servers.
```

The pattern in Proschi is a service reading one key from an in-memory store:

```proschi
title "Precomputed lookup"

client "Client"        [Actor]
api    "Lookup API"    [REST API] x4
store  "Top-k Store"   [Redis]    x2

client -> api   : HTTPS
api    -> store : GET

usecase "Lookup" {
  client -> api   : GET /lookup?prefix=ab
  api    -> store : GET topk:ab
  store --> api   : ["abc", "abd"]
  api   --> client : 200
}
```

```quiz
trie-top-k
```

### Caching at the edge

A **CDN** (content delivery network) is a fleet of caching proxies close to users. When a response carries a header such as `Cache-Control: max-age=300`, the CDN may serve the same answer to everyone who asks for that URL in the next five minutes, without contacting your servers.

Autocomplete fits unusually well: a few thousand short prefixes (`i`, `ip`, `sam`, `nik`) make up most requests, and their answers are the same for every user. Caching them at the edge removes most of the load and shortens the round trip for users far from your data center.

The trade-offs are staleness (up to the TTL, which the problem allows) and control: evicting one prefix from thousands of edge caches is hard, so you rely on short TTLs. Do not use it for personalised responses, data that must be fresh to the second, or long-tail keys rarely requested twice (the CDN only adds a hop).

````deepdive An edge cache in Proschi
The edge is two scenarios of the same use case, a hit that returns from the CDN and a miss that goes on to your servers:

```proschi
title "Edge cache"

client "Client"   [Actor]
cdn    "CDN"      [AWS CloudFront] x2
lb     "LB"       [AWS Load Balancer] x2
api    "API"      [REST API] x4

client -> cdn : HTTPS
cdn    -> lb  : origin
lb     -> api : HTTP

usecase "Read" {
  client -> cdn : GET /items/42
  alt "Edge hit" {
    cdn --> client : 200 cached
  } alt "Edge miss" {
    cdn  -> lb     : GET /items/42
    lb   -> api    : GET /items/42
    api --> lb     : 200 Cache-Control max-age=300
    lb  --> cdn    : 200
    cdn --> client : 200
  }
}
```
````

### Logging off the request path, rebuilding in batch

Updating counters synchronously puts a write, and its failure modes, on every search. Instead, **append each query to a log** (a Kafka topic) asynchronously and let an offline job count. In Proschi an async send is `->>`: the sender hands the message over and does not wait for the consumer. Searches keep working if the builder is slow or down, and the builder can reprocess days of queries at its own pace.

A scheduled batch job reads the log, counts per prefix (often with time decay), and writes each prefix's new top ten with a plain `SET`. That replaces the old list atomically per key: readers see the old or the new list, never half of one.

Trade-offs: minutes of lag, and a full rebuild is real work. A streaming job is fresher but has more moving parts; sampling the log is cheaper but less accurate. When freshness is a product requirement (breaking news), use streaming with a short window instead.

```proschi
title "Log now, aggregate later"

client "Client"     [Actor]
api    "API"        [REST API] x2
log    "Event Log"  [Kafka]    x2

client -> api : HTTPS
api    -> log : produce

usecase "Act" {
  client -> api    : POST /actions
  api   ->> log    : ActionDone
  api   --> client : 202
}
```

```callout takeaway
Nobody is waiting for the query log. Keep it **off the request path** with `->>`, and let a scheduled job do the counting.
```

```quiz
batch-is-fine
```

## Designing it step by step

### 1. Scope the problem

Ask: prefix-only or fuzzy? Global or personalised? How fresh? How many results, ranked by what? What scale? Here: prefix-only, global, up to five minutes stale at the edge and 15 minutes behind on rankings, top ten by popularity, 100k rps. Say it out loud: global, slightly stale answers are what make caching legal.

### 2. High-level design

Draw three flows, one per use case.

- **Suggest**: user → CDN → (on a miss) load balancer → Suggest Service → suggestion store.
- **Search**: user → load balancer → Search API → search cluster, plus an async append to the query log.
- **Rebuild**: scheduler → index builder → reads the query log → writes the suggestion store.

Dismiss the starter's wildcard query on Elasticsearch, natural because the cluster exists, with numbers: 100k rps against a 9k-rps cluster. The second is computing suggestions from a database (`LIKE 'ipho%' ORDER BY count DESC LIMIT 10`), which reads many rows per keystroke on the hottest path.

What wins is to **precompute and cache twice**: the lists live in memory, and the most popular are also cached at the edge.

### 3. Deep dive

**Sizing the miss path.** Only 20% of keystrokes reach your servers. Size the load balancer, the Suggest Service and Redis for 20k rps, then check that no node goes above roughly 70% (the simulation paints it amber) and that removing one replica of each does not saturate it. For the service, aim lower than 70%: the miss path already has four hops, and queueing at the busiest node is what pushes p99 over. Compute `replicas = load ÷ (2k × target utilisation)` and try it; if p99 is just over 50 ms, the service is queueing, so add replicas there.

**Why the edge hit never touches a service.** The check `"Suggest" scenario "Edge hit" never calls any service` (in the test "Suggestions are served by the CDN, then the cache") encodes the whole point of the CDN. If your hit scenario still goes to an API (say, one that checks a cache), you have built a cache, not an edge, and you pay for the servers anyway.

**Search and rebuild.** The Search API takes 2k rps, so a few replicas suffice, and the log write is `->>`, so a slow broker never slows a search. The builder reads the log and writes the store; it never queries the search cluster, which is busy serving searches.

**Failure.** Give every node you run at least two replicas, the lightly loaded builder and store included, then check the analysis for single points of failure.

### 4. Wrap-up

Summarise: precompute the top ten per prefix every 15 minutes, serve it from Redis behind a CDN that answers 80% of keystrokes, log searches asynchronously. Then name next steps: time-decayed ranking, and client-side debouncing and caching that cut the request rate before it reaches the CDN.

## Common mistakes

**Suggestions without a CDN** (`wrong/suggestions-without-cdn.proschi`). Every keystroke goes through the load balancer to the Suggest Service, which then needs about 100 replicas ($10,000, about $13,000 a month in total). The most common whiteboard design, not wrong so much as expensive: you pay to serve the same few thousand answers millions of times. It fails the flow test "Suggestions are served by the CDN, then the cache" and the cost requirement.

**The search waits for the query log** (`wrong/search-waits-for-query-log.proschi`). The API sends the query to Kafka with `->` and waits for an acknowledgement. In production every Kafka hiccup, rebalance or slow disk becomes search latency, and a broker outage a search outage, all for data no user is waiting for. It fails "Searches feed the query log without waiting for it".

**The rebuild triggered by the Search API** (`wrong/rebuild-from-search-api.proschi`). The API starts a rebuild instead of the scheduler. That couples heavy batch work to user traffic: a spike becomes a rebuild storm, and quiet hours mean no rebuilds at all. It fails "The index is rebuilt offline from the query log", whose first check is that the rebuild starts at the scheduler.

**Prefix queries on the search cluster** (the starter design). The cluster is sized for 2k searches a second (about 9k at most), not 100k keystrokes, and the design fails "Suggestions never touch the search cluster".

**A load balancer instead of a CDN.** Load balancers spread requests; they do not cache them. An `[AWS Load Balancer]` in the CDN's place fails the flow test, and the servers behind it still see every keystroke.

## In the interview

Lead with the insight, then the numbers. Draw the three flows, then do the arithmetic for the miss path on the board.

```callout interview Open with the insight
"Suggestions are read 50 times more often than anything is written, they are the same for everyone, and they change slowly. So I precompute them and cache them as close to the user as I can."
```

Follow-up questions you should expect:

- **How do you handle a trending query?** Shorten the rebuild interval for the top prefixes, or add a streaming path that updates a small set of hot prefixes between rebuilds. The CDN TTL bounds how stale the edge can be.
- **How do you personalise?** Keep the global list at the edge and merge a small per-user list (recent searches) on the client or in the service. Personalised responses cannot be cached at the CDN, so keep that part small.
- **What if the suggestion data no longer fits in one Redis?** Shard by prefix (or by a hash of the prefix). Short prefixes are the hottest keys, so replicate those widely or keep them in every shard.
- **How do you stop offensive suggestions?** Filter in the builder before publishing, and purge the few already cached.
- **What if Kafka is down?** Searches still work, because logging is asynchronous; the next rebuild just uses older data.
- **Why not a trie in the service's own memory?** It saves a hop, but every replica must load and refresh the whole structure. Either is fine if you name the trade-off.

## Further reading

- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network): push versus pull CDNs and TTLs, the basis of the edge layer here.
- [System Design Primer: Cache](https://github.com/donnemartin/system-design-primer#cache): where caches sit (client, CDN, server, database) and the update strategies.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message queues and back pressure, the idea behind the query log.
- [System Design Primer: Design a key-value cache to save the results of the most recent web server queries](https://github.com/donnemartin/system-design-primer/tree/master/solutions/system_design/query_cache): a worked design for caching search results with hit and miss use cases.
- [Cleo: the open source technology behind LinkedIn's typeahead search](https://engineering.linkedin.com/open-source/cleo-open-source-technology-behind-linkedins-typeahead-search): a real typeahead engine, and the difference between global ("generic") and per-user ("network") typeahead.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): see "Distributed Searching" for engineering posts on autocomplete and search at real companies.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): the chapters "Design A Search Autocomplete System" and "A Framework For System Design Interviews".
