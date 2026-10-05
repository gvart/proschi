## What you'll learn

- How to recognise a **read-heavy** workload, and why it changes where you
  spend your effort.
- The **cache-aside** pattern: read the cache first, fall back to the
  database on a miss, and fill the cache on the way back.
- Why a small share of slow requests (the cache misses) decides your **p99
  latency**, and how to reason about it with simple arithmetic.
- What **durability** means for a write path: the answer goes out only after
  the data is somewhere that survives a crash.
- How to make a design survive the loss of **any single machine**, and how to
  size replicas without blowing the budget.

## The problem, explained

A URL shortener does two things. It takes a long address such as
`https://example.com/blog/2026/10/a-very-long-title` and hands back a short
code like `aZ3x9`. Later, anyone who opens `https://sho.rt/aZ3x9` is sent to
the long address with an HTTP redirect.

The two operations are wildly unequal. A link is created once, but it may be
opened thousands of times: in this problem redirects arrive at 10,000 requests
per second while shortening runs at 100. That 100-to-1 ratio is the single
most important fact in the statement. Whatever makes a redirect cheap and
fast matters far more than anything you do to the shortening path.

The two paths also have different priorities:

- **Shorten** must never lose a code. If the visitor received `aZ3x9` and
  printed it on a poster, the mapping has to exist forever, even if a server
  crashes a millisecond after answering.
- **Redirect** must be fast and almost always available. A visitor clicking a
  link expects to land on the page immediately; a slow redirect feels like a
  broken link.

> A good first sentence in an interview: "This is a read-heavy key-value
> lookup with a durable, low-volume write path. I'll optimise the read path
> with a cache and keep the write path simple and safe."

## Back-of-the-envelope

Rough numbers first, so every later decision has a reason behind it. Round
aggressively; the goal is the order of magnitude, not the third digit.

| Quantity | Estimate | How |
|---|---:|---|
| New links per day | ~8.6 million | 100 rps × 86,400 s |
| New links per year | ~3.2 billion | 8.6 M × 365 |
| Size of one record | ~500 bytes | code, target URL, timestamps, owner |
| Storage growth | ~4 GB/day, ~1.5 TB/year | 8.6 M × 500 B |
| Redirect bandwidth | ~5 MB/s | 10k rps × ~500 B per response |
| Codes with 7 base62 characters | ~3.5 trillion | 62⁷ |

A few conclusions fall straight out of this table:

- **Seven characters are plenty.** At 3.2 billion codes a year, a 7-character
  base62 space lasts for centuries. Six characters (about 57 billion) would
  last well over a decade, which is also a fine answer if you say so.
- **The data is small per item but grows steadily.** One machine could hold a
  year of links, but you want replicas anyway for durability and
  availability, so pick a store that replicates for you.
- **The hot set fits in memory.** The statement says 95% of redirects go to
  recently opened codes. Even if "recent" means tens of millions of codes, at
  roughly 500 bytes each that is a few gigabytes: comfortably inside a Redis
  node's memory.
- **Compute is the thing to size.** In Proschi's simulation a REST API
  replica handles about 2,000 requests per second. 10,000 rps therefore needs
  at least five busy replicas, and you should run well below 100% busy,
  because queues grow sharply as a server approaches saturation.

## Concepts

### Read-heavy workloads

When reads outnumber writes by one or two orders of magnitude, the cheapest
request is the one that never reaches the database. Databases are built to
keep data safe and consistent, which costs disk writes, replication and
locking; an in-memory cache such as Redis skips all of that and answers a
key lookup in well under a millisecond. Moving the common read off the
database lowers latency, lowers database load and usually lowers cost too,
because one cache node replaces several database replicas you would
otherwise need just to absorb reads.

### Cache-aside (lazy loading)

Cache-aside is the most common way to put a cache in front of a database.
The application, not the cache, is in charge:

1. Look the key up in the cache.
2. **Hit**: return the value. The database is never touched.
3. **Miss**: read the value from the database, return it, and **write it into
   the cache** so the next request for the same key hits.

The third step is the one people forget. A cache that is never filled on a
miss only contains what you put there at write time, and its hit ratio
quietly decays as old entries expire. Filling it can be fire-and-forget: the
visitor does not need to wait for the `SET` to finish before being
redirected. In Proschi that is the `->>` arrow. The general shape, shown here
for a user profile rather than for this problem, looks like this:

```proschi fragment
usecase "Show profile" {
  web -> cache : GET profile:42
  alt "Hit" when "the profile was read recently" {
    cache --> web : profile
  } alt "Miss" when "it was not" {
    cache --> web   : nil
    web    -> db    : SELECT profile
    db    --> web   : profile
    web   ->> cache : SET profile:42
  }
}
```

Cache-aside tolerates a cache outage well: if Redis is down, every request
becomes a miss and the database answers, slower but correctly. That is why
the cache must never be the only copy of anything you promised to keep.

### Why the misses decide p99

Latency requirements are usually stated as a percentile: "p99 under 50 ms"
means 99 out of 100 requests finish within 50 ms. Here is the trap: if 5% of
redirects are cache misses, the slowest 5% of all redirects are (roughly) the
misses. The 99th percentile sits inside that slow 5%, so **p99 is a miss's
latency**, not a hit's. A blazing-fast cache does not help p99 if the miss
path is slow.

So make the miss path fast enough on its own: a single-key read from a
key-value store, no joins, no scans, and no extra round trips. Writing the
cache back asynchronously keeps the `SET` out of the visitor's wait. As a
rule of thumb, whenever the slow path is more than 1% of traffic, the slow
path *is* your p99.

### Durability: write before you answer

A write is durable when it has reached storage that survives the loss of a
machine: a replicated database, not process memory and not a cache. The rule
for the shorten path is simple: **the INSERT happens before the 201
response.** If you answer first and write later (or write only to Redis), a
crash in between leaves a visitor holding a code that leads nowhere. Queues
can make writes asynchronous safely, but only if the queue itself is durable
and the code can never be served before it is stored; for 100 rps there is no
reason to add that complexity.

### Generating short codes

There are three common approaches, and interviewers like to hear the
trade-offs:

| Approach | How it works | Trade-off |
|---|---|---|
| Counter + base62 | A unique number per link, encoded in `[0-9a-zA-Z]` | Short and collision-free; the counter must be distributed (ranges per server, or an ID generator) and codes are guessable |
| Hash of the URL | First characters of e.g. SHA-256 of the target | Same URL gives the same code; truncated hashes collide, so you need a check-and-retry |
| Random code | Random 7 characters, check the database for a clash | Unguessable; every insert needs a uniqueness check (a conditional write) |

Any of them works for this problem; what matters is that you name the
collision story. A common production choice is a counter split into ranges
(each API server reserves a block of a thousand numbers at a time), so no
single coordinator sits on the hot path.

### Redundancy: two of everything

"Losing any single machine must not take the service down" means every
component in a request path needs at least two instances: two load balancer
nodes, two or more API replicas, a cache with a replica, a database with
replicas. When one fails, the others must still have enough headroom to carry
the full load. If five API replicas are the minimum to serve 10,000 rps, then
running exactly five means one failure overloads the rest; size for the
traffic *after* losing one.

Availability multiplies along a path. If the load balancer, API and store are
each 99.9% available and a request needs all three, the path is roughly
99.7%. Replicas work the other way: two independent 99% instances are
available 1 − 0.01² = 99.99% of the time. That is why replicas, not better
hardware, are how you reach three nines.

### 301 or 302?

A `301 Moved Permanently` lets browsers cache the redirect, so repeat visits
never reach you: less load, but you cannot count clicks or change the target
later. A `302 Found` (temporary) sends every visit through your service, which
keeps analytics and editing possible at the cost of more traffic. This
problem asks for 302, which is also the usual choice when clicks are counted.

## Designing it step by step

1. **Start with the shape of the system.** A visitor reaches a load balancer,
   which spreads requests across stateless API servers. Behind them sit a
   database for the codes and a cache for recently opened ones. Stateless API
   servers matter: any replica can answer any request, so you can add or lose
   them freely.
2. **Write the shorten path for safety.** Generate the code, insert the row
   into the database, and only then return `201` with the code. There is no
   need for the cache here; most new links are not opened in the next
   millisecond, and the first redirect will fill it.
3. **Write the redirect path for speed.** The API asks the cache first. On a
   hit it returns the `302` immediately. On a miss it reads the database,
   returns the `302`, and fills the cache without making the visitor wait.
   Name the two alternatives after what they are: a hit and a miss.
4. **Choose the store.** The access pattern is a lookup by a single key, the
   data is small and grows steadily, and it must be replicated. A key-value
   store such as DynamoDB or Cassandra fits naturally; a replicated
   PostgreSQL works too at this scale. Say why you picked one.
5. **Size it.** Divide the peak traffic by what one replica handles, keep
   utilisation comfortably below saturation, and add enough spare capacity to
   survive the loss of one instance. Then check the cost: every replica you
   add is money, and the budget is part of the requirements.
6. **Check it against every requirement.** p99 of a redirect (a miss's
   latency), p99 of shortening (one database write), availability (no single
   point of failure), durability (write before answer) and cost. In Proschi,
   run the tests and read the Analysis tab: it shows each component's
   utilisation, which tells you where you are over- or under-provisioned.

## Common mistakes

- **No cache at all.** Every redirect goes to the database. It can work if
  you buy enough database capacity, but the database becomes the most loaded
  and most expensive part of the system, p99 rises with its load, and you have
  ignored the 100-to-1 ratio, which is the main point of the problem.
- **Reading the database before the cache.** If the database is asked first,
  the cache saves nothing: every request already paid the slow round trip.
  The order of the calls is the design.
- **Never filling the cache on a miss.** The design looks right on a
  whiteboard, but the cache only holds entries written at shorten time, the
  hit ratio decays, and in the real system more and more traffic falls
  through to the database. Proschi's test "Misses fill the cache" catches
  exactly this.
- **Answering before the data is stored.** Writing only to Redis, or
  returning the code and inserting it in the background, fails the durability
  requirement: one crash and a printed link is dead forever.
- **A single instance of anything.** One load balancer, one cache or one
  database is a single point of failure, and the availability arithmetic
  above shows why it cannot reach the target on its own.
- **Over-provisioning to be safe.** Doubling every replica count passes the
  latency tests but fails the budget. Sizing is part of the answer: show the
  division, the headroom and the spare for one failure.
- **Optimising the wrong path.** Elaborate machinery on the 100 rps write
  path (queues, sagas, multiple stores) adds failure modes without helping the
  10,000 rps that matter.

## In the interview

- **Clarify first.** Ask about the read-to-write ratio, whether links expire,
  whether custom aliases are allowed, whether clicks must be counted, and how
  long codes must stay valid. Each answer changes a decision: analytics push
  you to `302`, custom aliases need a uniqueness check, expiry needs a TTL and
  a cleanup job.
- **Do the numbers out loud.** Writes per day, storage per year, code length,
  peak reads. Interviewers want to see that your design follows from the
  numbers, not from habit.
- **Draw the read path first.** It carries 99% of the traffic. Say "cache
  first, database on a miss, fill the cache asynchronously", and explain why
  the misses decide p99.
- **Then defend durability.** "The code is inserted before we answer" is a
  one-line answer that shows you understand what must never be lost.
- **Expect follow-ups.** How do you generate codes across many servers
  without collisions? What happens when Redis goes down (every request becomes
  a miss: can the database take it)? How would you handle a link that
  suddenly goes viral (a hot key: replicate it, or cache it in the API
  process for a few seconds)? How would you block malicious targets?
- **Close with trade-offs.** Name what you chose not to do and why: no queue
  on the write path, `302` instead of `301`, a key-value store instead of a
  relational one.

## Further reading

- [The System Design Primer](https://github.com/donnemartin/system-design-primer)
  on GitHub: the sections on caching, cache-aside and availability in numbers.
- Alex Xu, *System Design Interview – An Insider's Guide*, the chapter
  "Design A URL Shortener".
- [Caching patterns](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)
  in AWS's whitepaper on database caching strategies with Redis: cache-aside
  and write-through compared.
- [302 Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302)
  and [301 Moved Permanently](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/301)
  on MDN.
- [Latency numbers every programmer should know](https://gist.github.com/jboner/2841832):
  why a memory lookup and a database round trip are worlds apart.
- [How the simulation works](https://proschi.app/docs/model/): the formulas
  behind Proschi's latency, utilisation and availability numbers.
