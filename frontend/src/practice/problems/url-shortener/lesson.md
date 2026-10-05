## What you'll learn

- How to spot a **read-heavy** system and why that one ratio shapes the whole design.
- The **cache-aside** pattern: read the cache first, fall back to the database, then fill the cache so the next reader hits.
- Why **p99 is decided by the slow minority**: 5% of cache misses matter more than the 95% of hits.
- Why every component needs **at least two replicas**, and how to check that with simple availability arithmetic.
- How short codes are made (counter + Base62, hashing, random) and what each choice costs.

## The problem, explained

A URL shortener takes a long link and hands back something like `https://sho.rt/aZ3x9`. Anyone who opens the short link is sent on to the long one. Think of bit.ly or TinyURL: links in tweets, text messages and printed posters, where every character counts.

There are two use cases:

- **Shorten**: a visitor posts a long URL and gets a short code back with `201 Created`.
- **Redirect**: a visitor opens `/<code>` and gets a `302 Found` with a `Location` header pointing at the long URL. The browser follows it on its own.

The non-functional requirements are where the design lives:

- **Scale**: 10k redirects per second and 100 shortenings per second. 95% of redirects are for codes that were opened recently.
- **Latency**: p99 of a redirect under 50 ms, of shortening under 200 ms. *p99* means the 99th percentile: 99 out of 100 requests are at least that fast.
- **Availability**: redirects work 99.9% of the time. A dead short link is a broken link on every poster that printed it.
- **Durability**: once a code was returned, it is never lost. It must be written to a database (not only to memory) before the answer.
- **Fault tolerance**: losing any one machine must not take the service down.
- **Budget**: at most $3,000 a month.

`given.proschi` fixes only the `visitor`, the traffic, the requirements and the tests. Everything between the visitor and the data is yours to draw. The traffic block also fixes the scenario mix: `"Cache hit"` 95% and `"Cache miss"` 5%. You don't get to pick your hit rate; you get to decide what happens on each path.

The tests check four ideas, in plain words:

1. A redirect asks the **cache before the database**, and a cache hit **never touches the database**.
2. A cache miss **fills the cache** after reading the database.
3. Shortening **writes to a database before responding**, and answers `201`.
4. Redirects answer **`302`**.

On top of that come the requirement checks: p99 per use case, availability, durability, surviving any single node failure, and the monthly cost.

## Back-of-the-envelope

Start with the ratio. 10,000 redirects against 100 shortenings is **100 reads for every write**. That single number tells you to optimise the read path and keep the write path simple.

| Quantity | Arithmetic | Result |
|---|---|---|
| Read:write ratio | 10,000 ÷ 100 | 100 : 1 |
| New codes per day | 100 × 86,400 s | 8.64 million |
| New codes per year | 8.64 M × 365 | ≈ 3.2 billion |
| Storage per year | 3.2 B × ~500 bytes per row | ≈ 1.6 TB |
| Codes available, 6 Base62 chars | 62⁶ | ≈ 57 billion (≈ 18 years) |
| Codes available, 7 Base62 chars | 62⁷ | ≈ 3.5 trillion |
| Redirects that hit the cache | 10,000 × 95% | 9,500 rps |
| Redirects that reach the database | 10,000 × 5% | 500 rps |
| Cache writes (fills on miss) | same as misses | 500 rps |

The 500-byte row is an assumption (code, URL, timestamp, overhead). A few terabytes a year fits one modern database, so storage is not what makes this problem hard.

Now the per-component load. In Proschi's simulation each kind of node has a default capacity per replica ([How the simulation works](https://proschi.app/docs/model/) lists them all):

| Component | Load it sees | Capacity per replica | Replicas at 100% busy |
|---|---|---|---|
| API service (`[REST API]`) | 10,000 + 100 = 10,100 rps | 2,000 rps | ≈ 5 |
| Cache (`[Redis]`) | 10,000 reads + 500 writes | 100,000 rps | 1 |
| Database (`[DynamoDB]`) | 500 reads + 100 writes | 20,000 rps | 1 |

The right-hand column is a **floor, not an answer**. At 100% a node is saturated and every latency requirement that touches it fails. The simulation models each node as a queue: the busier the replicas, the longer a request waits for a free one, and the wait balloons as utilisation nears 100%. Anything above 70% is flagged as *hot*. Size the API well below that, then read p99 in the Analysis tab and adjust.

A few more estimates show up directly in the numbers:

- **Latency.** The default idle latencies are about 2 ms for a load balancer, 10 ms for a service, 1 ms for Redis and 5 ms for a database. A hit path is roughly *load balancer + API + cache*; a miss path adds the database read and the cache fill. The simulation turns each hop's mean into a percentile; an idle hop's p99 is about 2.8× its mean. Add up the hops on the miss path and multiply, and you'll see why the miss path is the one that pushes against 50 ms.
- **Availability.** A single service replica is up 99.5% of the time in the model. That alone fails a 99.9% target. Two replicas are both down only 0.5% × 0.5% = 0.0025% of the time, so the node is up 99.9975%. Every node on the path multiplies in, which is why "two of everything" is the starting point.
- **Cost.** Every replica has a flat monthly price: roughly $50 for a load balancer, $100 for a service, $150 for Redis, $400 for PostgreSQL, $500 for DynamoDB. Multiply out your replica counts before you run anything and you'll know whether you are near the $3,000 line.

## Concepts

### Cache-aside (lazy loading)

**What it is.** The application owns the cache. On a read it asks the cache first. On a hit, it is done. On a miss, it reads the database, writes the value into the cache (usually with a time-to-live, *TTL*), and returns it. The database never talks to the cache directly.

**Why it works.** Access to links is wildly skewed: a viral link gets millions of clicks in an hour, most links a handful ever. Keeping only *recently used* codes in memory gives a high hit rate with a cache far smaller than the database, answering in about a millisecond.

**Trade-offs.** The first reader of every code pays a miss. Cached values can go stale if the underlying row changes, which is why caches usually carry a TTL. A cold cache (after a restart) sends a burst of misses to the database.

**When not to use it.** When data changes on every read, when every key is read only once (nothing to reuse), or when reads are rare compared to writes. Also be careful when a stale value is dangerous, like a balance or a permission.

Here is the pattern in Proschi, for a generic product catalogue:

```proschi
title "Cache-aside"

user  "User"        [Actor]
api   "Catalog API" [REST API]   x2
cache "Item cache"  [Redis]      x2
db    "Items DB"    [PostgreSQL] x2

user -> api
api  -> cache : GET / SET
api  -> db    : SQL

usecase "Get item" {
  user -> api   : GET /items/42
  api  -> cache : GET item:42
  alt "Hit" {
    cache --> api : item
  } alt "Miss" {
    cache --> api   : nil
    api    -> db    : SELECT item 42
    db    --> api   : item
    api   ->> cache : SET item:42
  }
  api --> user : 200
}
```

Notice `->>` on the fill: the API doesn't need to wait for the `SET` before answering, so the fill is off the critical path.

**The miss path decides p99.** Averages hide pain: if 95% of requests take 12 ms and 5% take 60 ms, the mean is about 14 ms, but the slowest 1% are all misses. A redirect's p99 is computed over all redirects, hits and misses mixed by share, so with 5% misses it sits deep inside the miss path. Shaving the hit path does little; removing a hop or queueing from the miss path does a lot.

### Redundancy and availability arithmetic

**What it is.** Any single machine fails sooner or later: hardware, kernel panics, deployments. A *single point of failure* (SPOF) is a component whose loss takes the use case down. The fix is replicas behind something that routes around a dead one.

**The arithmetic.** In sequence, availabilities multiply: a path through three nodes at 99.9% each is 99.7%. In parallel, *unavailabilities* multiply: two replicas at 99.5% are down together only 0.0025% of the time. So you add replicas to each node until the product of the path clears the target.

**Trade-offs.** Each replica costs money, and stateful replicas need replication (and a story for which copy is right). For stateless services like the API, extra replicas are cheap and simple.

**When not to.** For a prototype or an internal tool with no availability promise, one instance is fine. Just know what you're accepting.

A minimal redundant tier looks like this:

```proschi
title "Redundant tier"

client "Client"        [Actor]
lb     "Load Balancer" [AWS Load Balancer] x2
web    "Web"           [REST API]          x3

client -> lb
lb     -> web : HTTPS
```

### Generating short codes

There are three classic approaches:

- **Counter + Base62.** Take a unique integer (from a database sequence, or a range of numbers handed to each API server in blocks) and write it in Base62 (`0-9a-zA-Z`). Codes are short and never collide. The downside: sequential codes are guessable, so people can enumerate links. Scrambling the number with a reversible permutation fixes that.
- **Hash the URL** (MD5, SHA-256) and keep the first 7 characters. The same URL always gets the same code, which is nice for deduplication, but truncated hashes collide, so you must check and retry.
- **Random codes.** Simple and unguessable; also needs a collision check, which gets more frequent as the keyspace fills.

**When not to use a counter.** If codes must be unguessable (private documents, password-reset links), use long random tokens instead, and accept the longer URL.

A counter doesn't have to mean a database round trip per link. Each API server can claim a block of numbers once and hand them out from memory:

```proschi
title "Counter blocks"

user "User"     [Actor]
api  "Link API" [REST API]   x3
seq  "Sequence" [PostgreSQL] x2

user -> api
api  -> seq : SQL

usecase "Claim block" {
  api  -> seq : UPDATE ranges SET next = next + 1000
  seq --> api : 52000 to 52999
}

usecase "New code" {
  user -> api  : POST /links
  api  -> seq  : INSERT link with the next number
  seq --> api  : ok
  api --> user : 201 the number in Base62
}
```

The reference design picks the counter. You'll meet unique-ID generation in depth in the Snowflake problem later on this roadmap.

## Designing it step by step

### Step 1: Scope the problem

Before drawing anything, pin down what you are building. Questions worth asking out loud:

- How many redirects and new links per second? (Here: 10k and 100.)
- Can links expire or be edited? (Not here, which makes caching easy: a code's target never changes.)
- Custom aliases? Analytics on clicks? (Out of scope; say so.)
- 301 or 302? (The tests ask for `302`; see the interview section for why.)

### Step 2: High-level design

Draw the simplest thing that meets the functional requirements: visitor → API → database. Shorten inserts a row; Redirect looks it up. This works, and it's worth saying so, but check it against the numbers. Every one of 10k redirects pays a database round trip, the database carries the whole read load, and the redirect test fails because nothing is cached.

Now add the cache on the read path, using cache-aside. Draw the `Redirect` use case with two `alt` scenarios named exactly `"Cache hit"` and `"Cache miss"`. On the hit, the cache answers and the database is never called. On the miss, read the database, then fill the cache.

Put a load balancer in front of the API so a visitor never depends on one API instance.

### Step 3: Deep dive

**Which database?** The data is a key → value lookup with no joins. Both a key-value store (DynamoDB, Cassandra) and a relational database (PostgreSQL) handle 100 writes and 500 reads per second. A key-value store scales writes horizontally as the service grows; a relational database is cheaper per replica here and gives you uniqueness constraints for free. Either is defensible: pick one and say why.

**The write path.** `Shorten` must write to the database *before* it responds; a code that exists only in the cache or in a queue could vanish. Don't put a cache write on the shorten path unless you have a reason: the link may never be opened, and the miss path will fill the cache when it is.

**The miss path.** This is where your p99 is decided. Count the hops: load balancer, API, cache (miss), database, and the fill. Make the fill asynchronous (`->>`) so the visitor doesn't wait for it. Then keep each hop un-queued: if the API replicas are busy, every hop through them waits.

**Sizing.** Take the per-component load table above, choose replica counts that keep every node comfortably below 70%, and make sure each node still holds up with *one replica fewer*. The `survive any node failure` check removes one replica from each node and re-runs the analysis. Then read the Analysis tab: is p99 of `Redirect` under 50 ms with room to spare? Is the total under $3,000? If the cost is tight, look at what each replica costs before cutting the ones on the hot path.

**What if Redis is down?** With two cache replicas the cache is very available, and losing one is survivable. A more robust design also handles the whole cache being unreachable: a scenario where the API's cache call fails (`-x`) and it goes straight to the database. That is a *fallback*. It is optional here, but it's a great thing to mention in an interview, along with its risk: if the cache really dies at 10k rps, the database suddenly sees 20× its normal read load.

### Step 4: Wrap up

Summarise in one breath: "A stateless API behind a load balancer; codes written to a database before we answer; a Redis cache with cache-aside, so 95% of redirects never touch the database; two or more of everything." Then name what's next: click analytics through a queue, abuse detection, custom aliases, expiry.

## Common mistakes

**The miss never fills the cache** (`wrong/miss-never-fills-cache`). The design reads the cache, misses, reads the database and answers, but never writes the code into the cache. In production this is a silent disaster: the cache only ever contains what something else put there, the hit rate decays toward zero, and the database takes the full read load. Latency and load numbers can look fine in a simulation that assumes a fixed 95% hit rate, which is exactly why a flow test catches it here: **Misses fill the cache** requires a cache call after the database call in the `"Cache miss"` scenario.

**No cache at all.** Every redirect goes to the database. It might even meet the latency limit on paper with enough database replicas, but it fails **Redirects read the cache first**, and in reality you'd pay for a database sized for the full read load.

**Cache after the database.** Reading the database first and then the cache gets the order backwards: the cache saves nothing. **Redirects read the cache first** checks the order.

**Only writing to the cache on Shorten.** Fast, but a cache is memory: a restart or eviction loses codes that were already handed out. **Codes are stored before they are returned** (and the `durable` requirement) catches it.

**One of anything.** A single API, cache or load balancer is a SPOF. One API replica also fails the 99.9% availability target by itself (99.5% per replica). `survive any node failure` catches it.

**Running the API hot.** Five API replicas carry 10k rps on paper, but at 100% they're saturated and at 90% the queueing wrecks p99. The p99 requirement on `Redirect` catches it.

**Answering 200 or 301.** The tests ask for `302`: **Redirects redirect**.

## In the interview

**How to present it.** Lead with the ratio: "100 reads per write, so this is a read-optimisation problem." Sketch the naive design in ten seconds, point at the database as the bottleneck, then introduce the cache and walk through hit and miss. Keep the write path boring on purpose. Finish with redundancy and the numbers that justify your replica counts.

Follow-up questions you'll likely get:

- **"How do you generate codes without collisions?"** A counter in Base62 never collides. To avoid a single counter bottleneck, give each API server a block of numbers (say 1,000 at a time) from a central sequence. If enumeration is a concern, permute the numbers.
- **"301 or 302?"** 301 is cached by browsers, cheaper for us, but we lose click counts and can't change the target. 302 keeps every click visible. Most shorteners that sell analytics use 302.
- **"What's your cache eviction policy?"** LRU (least recently used) with a TTL. Codes never change, so staleness isn't a worry; memory is.
- **"What happens when the cache goes down?"** Fall back to the database, ideally with a limit on how hard you hit it, and warm the cache back up. Mention the thundering-herd risk.
- **"How would you add click analytics?"** Publish a click event to a queue asynchronously on each redirect, and count in a separate pipeline. Never put analytics on the redirect's critical path.
- **"How do you stop abuse?"** Rate-limit shortening per user or IP, and check targets against a phishing list.

## Further reading

- [System Design Primer: Cache-aside](https://github.com/donnemartin/system-design-primer#cache-aside): a compact explanation of the pattern used here, with its drawbacks.
- [System Design Primer: Design Pastebin.com (or Bit.ly)](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md): a full worked solution, including MD5 vs Base62 codes and usage estimates.
- [System Design Primer: Availability in numbers](https://github.com/donnemartin/system-design-primer#availability-in-numbers): the sequence-vs-parallel availability arithmetic in one table.
- [AWS: Caching best practices](https://aws.amazon.com/caching/best-practices/): lazy loading vs write-through, and how to think about TTLs.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A URL Shortener": the interview-format walkthrough of this exact problem, including hash vs counter codes.
- [How the simulation works](https://proschi.app/docs/model/): every default capacity, latency and price behind the numbers in this lesson.
- [awesome-system-design](https://github.com/madd86/awesome-system-design): a curated list of articles, books and videos to keep going after the foundations.
