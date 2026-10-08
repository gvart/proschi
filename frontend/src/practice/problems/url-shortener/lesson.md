```tldr
Reads outnumber writes **100 to 1**, so this is a read-optimisation problem. Put a **cache-aside** Redis in front of the database so 95% of redirects never touch it, write every new code to the database **before** answering, and run **two of everything** so one dead machine changes nothing.
```

## What you'll learn

- How to spot a **read-heavy** system and why that one ratio shapes the whole design.
- The **cache-aside** pattern: read the cache first, fall back to the database, then fill the cache so the next reader hits.
- Why **p99 is decided by the slow minority**: 5% of cache misses matter more than the 95% of hits.
- Why every component needs **at least two replicas**, and how to check that with simple availability arithmetic.
- How short codes are made (counter + Base62, hashing, random) and what each choice costs.

## The problem, explained

A URL shortener takes a long link and hands back something like `https://sho.rt/aZ3x9`. Opening the short link sends you on to the long one. Think of bit.ly or TinyURL: links in tweets, text messages and printed posters, where every character counts.

There are two use cases:

- **Shorten**: a visitor posts a long URL and gets a short code back with `201 Created`.
- **Redirect**: a visitor opens `/<code>` and gets a `302 Found` whose `Location` header points at the long URL. The browser follows it on its own.

The non-functional requirements are where the design lives:

- **Scale**: 10k redirects and 100 shortenings per second. 95% of redirects are for codes opened recently.
- **Latency**: p99 of a redirect under 50 ms, of shortening under 200 ms. *p99* is the 99th percentile: 99 out of 100 requests are at least that fast.
- **Availability**: redirects work 99.9% of the time. A dead short link is a broken link on every poster that printed it.
- **Durability**: once a code has been returned, it is never lost. It must reach a database (not only memory) before the answer.
- **Fault tolerance**: losing any one machine must not take the service down.
- **Budget**: at most $3,000 a month.

`given.proschi` fixes only the `visitor`, the traffic, the requirements and the tests; everything between the visitor and the data is yours to draw. The traffic also fixes the scenario mix: `"Cache hit"` 95% and `"Cache miss"` 5%. You don't pick your hit rate; you decide what happens on each path.

The tests check four ideas:

1. A redirect asks the **cache before the database**, and a cache hit **never touches the database**.
2. A cache miss **fills the cache** after reading the database.
3. Shortening **writes to a database before responding**, and answers `201`.
4. Redirects answer **`302`**.

On top come the requirement checks: p99 per use case, availability, durability, surviving any single node failure, and the monthly cost.

## Back-of-the-envelope

```numbers
100 : 1 | reads for every write
9,500 rps | redirects answered by the cache
500 rps | redirects that reach the database
≈ 1.6 TB | new data per year
57 billion | 6-character Base62 codes
```

Start with the ratio. 10,000 redirects against 100 shortenings is **100 reads for every write**: optimise the read path, keep the write path simple.

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

The 500-byte row is an assumption (code, URL, timestamp, overhead). About 1.6 TB a year fits one modern database: storage is not what makes this problem hard.

```quiz
hit-rate-to-db-load
base62-code-space
```

Now the per-component load. In Proschi's simulation each kind of node has a default capacity per replica ([How the simulation works](https://proschi.app/docs/model/) lists them all):

| Component | Load it sees | Capacity per replica | Replicas at 100% busy |
|---|---|---|---|
| API service (`[REST API]`) | 10,000 + 100 = 10,100 rps | 2,000 rps | ≈ 5 |
| Cache (`[Redis]`) | 10,000 reads + 500 writes | 100,000 rps | 1 |
| Database (`[DynamoDB]`) | 500 reads + 100 writes | 20,000 rps | 1 |

```callout pitfall The right-hand column is a floor, not an answer
At 100% a node is saturated and every latency requirement that touches it fails. The simulation models each node as a queue: the busier the replicas, the longer a request waits, and the wait grows very fast as utilisation nears 100%. Anything above 70% is flagged as *hot*. Size the API well below that, then read p99 in the Analysis tab.
```

Three more estimates show up directly in the numbers:

- **Latency.** Idle latencies are about 2 ms for a load balancer, 10 ms for a service, 1 ms for Redis and 5 ms for a database. A hit is roughly *load balancer + API + cache*; a miss adds the database read and the cache fill. An idle hop's p99 is about 2.8× its mean, so add up the miss path's hops and multiply: that is the path pushing against 50 ms.
- **Availability.** One service replica is up 99.5% of the time, which alone fails 99.9%. Two replicas are both down only 0.5% × 0.5% = 0.0025% of the time (up 99.9975%). Every node on the path multiplies in, hence "two of everything".
- **Cost.** Each replica has a flat monthly price: about $50 for a load balancer, $100 for a service, $150 for Redis, $400 for PostgreSQL, $500 for DynamoDB. Multiply out your replica counts before running anything.

## Concepts

### Cache-aside (lazy loading)

**What it is.** The application owns the cache. On a read it asks the cache first; on a hit, it is done. On a miss, it reads the database, writes the value into the cache (usually with a time-to-live, *TTL*) and returns it. The database never talks to the cache.

**Why it works.** Clicks are very uneven: a viral link gets millions in an hour, most links a handful ever. Keeping only *recently used* codes in memory gives a high hit rate from a cache far smaller than the database, answering in about a millisecond.

**Trade-offs.** The first reader of every code pays a miss. Cached values go stale if the row changes, which is why caches carry a TTL. A cold cache (after a restart) sends a burst of misses to the database.

**When not to use it.** When data changes on every read, when every key is read once (nothing to reuse), when reads are rare, or when a stale value is dangerous, like a balance or a permission.

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

Notice `->>` on the fill: the API doesn't wait for the `SET` before answering, so the fill is off the critical path.

```callout takeaway The miss path decides p99
If 95% of requests take 12 ms and 5% take 60 ms, the mean is about 14 ms, but the slowest 1% are **all misses**. Shaving the hit path does little; removing a hop or queueing from the miss path does a lot.
```

```quiz
average-latency-with-cache
cache-aside
```

### Redundancy and availability arithmetic

**What it is.** Every machine fails sooner or later: hardware, kernel panics, deployments. A *single point of failure* (SPOF) is a component whose loss takes the use case down. The fix is replicas behind something that routes around a dead one.

**The arithmetic.** In sequence, availabilities multiply: three nodes at 99.9% make a 99.7% path. In parallel, *unavailabilities* multiply: two replicas at 99.5% are down together 0.0025% of the time. Add replicas to each node until the product of the path clears the target.

**Trade-offs.** Each replica costs money, and stateful replicas need replication (and a story for which copy is right). Stateless services like the API are cheap and simple to replicate.

**When not to.** A prototype or internal tool with no availability promise can run one instance. Just know what you're accepting.

A minimal redundant tier:

```proschi
title "Redundant tier"

client "Client"        [Actor]
lb     "Load Balancer" [AWS Load Balancer] x2
web    "Web"           [REST API]          x3

client -> lb
lb     -> web : HTTPS
```

### Generating short codes

Three classic approaches:

| Approach | How | Upside | Cost |
|---|---|---|---|
| **Counter + Base62** | A unique integer written in `0-9a-zA-Z` | Short, never collides | Sequential codes are guessable (a reversible permutation fixes it) |
| **Hash the URL** | MD5 or SHA-256, keep 7 characters | The same URL gets the same code | Truncated hashes collide: check and retry |
| **Random codes** | Draw 7 random characters | Simple, unguessable | Collision checks grow as the keyspace fills |

```callout tip
If codes must be unguessable (private documents, password-reset links), skip the counter and use long random tokens, accepting the longer URL.
```

````deepdive Counter blocks: a counter without a database trip per link
Each API server claims a block of numbers once and hands them out from memory:

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

A server that crashes loses the rest of its block: a few gaps in the sequence, never a duplicate.
````

The reference design picks the counter. Unique-ID generation comes back in depth in the Snowflake problem later on this roadmap.

## Designing it step by step

### Step 1: Scope the problem

Pin down what you are building before drawing anything. Questions worth asking out loud:

- How many redirects and new links per second? (10k and 100.)
- Can links expire or be edited? (No, which makes caching easy: a code's target never changes.)
- Custom aliases? Click analytics? (Out of scope; say so.)
- 301 or 302? (The tests ask for `302`; the interview section says why.)

### Step 2: High-level design

Draw the simplest thing that works: visitor → API → database. Shorten inserts a row; Redirect looks it up. Say that it works, then check it against the numbers: every one of 10k redirects pays a database round trip, the database carries the whole read load, and the redirect test fails because nothing is cached.

Now add the cache on the read path, with cache-aside. Draw the `Redirect` use case with two `alt` scenarios named exactly `"Cache hit"` and `"Cache miss"`. On the hit the cache answers and the database is never called; on the miss, read the database, then fill the cache.

Put a load balancer in front of the API so a visitor never depends on one API instance.

### Step 3: Deep dive

**Which database?** A key → value lookup with no joins. A key-value store (DynamoDB, Cassandra) or PostgreSQL both handle 100 writes and 500 reads per second. Key-value scales writes horizontally as the service grows; relational is cheaper per replica here and gives you uniqueness constraints for free. Pick one and say why.

**The write path.** `Shorten` writes to the database *before* it responds; a code that lives only in a cache or a queue can vanish. Skip a cache write on this path: the link may never be opened, and the miss path will fill the cache when it is.

**The miss path.** Count its hops: load balancer, API, cache (miss), database, fill. Make the fill asynchronous (`->>`), and keep queueing low on each hop: busy API replicas make every request wait.

**Sizing.** Choose replica counts that keep every node comfortably below 70%, and check each still holds with *one replica fewer*: `survive any node failure` removes one from each node and re-runs the analysis. Then read the Analysis tab: p99 of `Redirect` under 50 ms with room to spare, the total under $3,000.

```deepdive What if Redis is down?
Two cache replicas make the cache very available, and losing one is survivable. A more robust design also handles the whole cache being unreachable: a scenario where the API's cache call fails (`-x`) and it goes straight to the database, a *fallback*. It is optional here, but great to mention in an interview with its risk: if the cache really dies at 10k rps, the database suddenly sees 20× its normal read load.
```

### Step 4: Wrap up

Summarise in one breath: "A stateless API behind a load balancer; codes written to a database before we answer; a Redis cache with cache-aside, so 95% of redirects never touch the database; two or more of everything." Then name what's next: click analytics through a queue, abuse detection, custom aliases, expiry.

## Common mistakes

**The miss never fills the cache** (`wrong/miss-never-fills-cache`). The design reads the cache, misses, reads the database and answers, but never writes the code into the cache. In production this is a silent disaster: the cache holds only what something else put there, the hit rate drops toward zero, and the database takes the full read load. A simulation with a fixed 95% hit rate can hide it, which is why a flow test catches it: **Misses fill the cache** wants a cache call after the database call in `"Cache miss"`.

**No cache at all.** Every redirect goes to the database. Enough database replicas might meet the latency on paper, but it fails **Redirects read the cache first**, and you'd pay for a database sized for the full read load.

**Cache after the database.** Reading the database first gets the order backwards: the cache saves nothing. **Redirects read the cache first** checks the order.

**Only writing to the cache on Shorten.** Fast, but memory: a restart or eviction loses codes already handed out. **Codes are stored before they are returned** (and `durable`) catch it.

**One of anything.** A single API, cache or load balancer is a SPOF, and one API replica alone fails 99.9% (99.5% each). `survive any node failure` catches it.

**Running the API hot.** Five API replicas carry 10k rps on paper, but at 100% they're saturated and at 90% queueing wrecks p99. The p99 requirement on `Redirect` catches it.

**Answering 200 or 301.** The tests ask for `302`: **Redirects redirect**.

## In the interview

**How to present it.** Lead with the ratio: "100 reads per write, so this is a read-optimisation problem." Sketch the naive design in ten seconds, point at the database as the bottleneck, then add the cache and walk through hit and miss. Keep the write path boring on purpose. Finish with redundancy and the numbers behind your replica counts.

```callout interview Say the ratio first
"100 reads per write" in the first minute tells the interviewer you know where the design lives. Everything after it, the cache, the miss path, the replica counts, follows from that number.
```

Follow-up questions you'll likely get:

- **"How do you generate codes without collisions?"** A counter in Base62 never collides. To avoid one counter bottleneck, give each API server a block of numbers (say 1,000) from a central sequence; permute them if enumeration is a concern.
- **"301 or 302?"** Browsers cache a 301, which is cheaper for us, but we lose click counts and can't change the target. 302 keeps every click visible; shorteners that sell analytics use it.
- **"What's your cache eviction policy?"** LRU (least recently used) with a TTL. Codes never change, so staleness isn't the worry; memory is.
- **"What happens when the cache goes down?"** Fall back to the database, ideally with a limit on how hard you hit it, and warm the cache back up. Mention the thundering-herd risk.
- **"How would you add click analytics?"** Publish a click event to a queue asynchronously on each redirect and count in a separate pipeline. Never put analytics on the redirect's critical path.
- **"How do you stop abuse?"** Rate-limit shortening per user or IP, and check targets against a phishing list.

## Further reading

- [System Design Primer: Cache-aside](https://github.com/donnemartin/system-design-primer#cache-aside): a compact explanation of the pattern used here, with its drawbacks.
- [System Design Primer: Design Pastebin.com (or Bit.ly)](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md): a full worked solution, including MD5 vs Base62 codes and usage estimates.
- [System Design Primer: Availability in numbers](https://github.com/donnemartin/system-design-primer#availability-in-numbers): the sequence-vs-parallel availability arithmetic in one table.
- [AWS: Caching best practices](https://aws.amazon.com/caching/best-practices/): lazy loading vs write-through, and how to think about TTLs.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A URL Shortener": the interview-format walkthrough of this exact problem, including hash vs counter codes.
- [How the simulation works](https://proschi.app/docs/model/): every default capacity, latency and price behind the numbers in this lesson.
- [awesome-system-design](https://github.com/madd86/awesome-system-design): a curated list of articles, books and videos to keep going after the foundations.
