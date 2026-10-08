# Web Crawler: a polite loop that never forgets a URL

```tldr
Two consumer pools loop around a **durable frontier**: fetchers ask a **per-host record** before every fetch, parsers check each link against a **Bloom filter** before it enters the frontier. Each **acknowledges its input only after its output is written**, so a crash refetches a page instead of losing a URL.
```

A crawler looks like the simplest program in the world: download a page, find its links, download those. At a few billion pages a month it becomes a lesson on queues: the work list outgrows your pace, almost every link is one you have seen, and the websites are someone else's servers that you must not knock over.

## What you'll learn

- What the URL frontier is, why it must be durable, and why it is partitioned by host.
- How per-host politeness works: robots.txt, crawl delays and putting a URL back instead of fetching it.
- How a Bloom filter deduplicates 90k links a second in a few gigabytes of memory, and what its false positives cost.
- Why the crawl is at-least-once, and where to acknowledge a URL so that a crash loses nothing.
- How to treat failing websites as normal: timeouts, backoff and retries.

## The problem, explained

**Who uses it.** A search engine's indexing pipeline. Nobody waits on a single fetch, but the crawl rate decides how fresh the index is.

**Functional requirements.**

- **Crawl page**: a fetcher takes a URL from the frontier and either fetches and stores the page (`"Host ready"`), puts the URL back after the site failed (`"Fetch failed"`), or puts it back because the host is not due yet (`"Host busy"`).
- **Parse links**: a parser reads a stored page, extracts the links, drops the seen ones and adds the new ones to the frontier.

**Non-functional requirements.**

- The frontier is durable: a URL leaves it only once its page is stored or it is back for a retry.
- At most one request to a host at a time, never before its crawl delay, never against robots.txt.
- Links deduplicated before the frontier.
- p99 (the latency 99% of requests beat) under 1.5 s for a crawl step and 200 ms for parsing.
- Available 99.9% even though websites fail; any machine can fail; at most $4,000 a month.

**What is given, and why.** `given.proschi` declares the websites as one external system answering in about 300 ms. They are slow, they fail, and you cannot add replicas to them: the crawler has to be reliable around them.

**What the tests check.**

- *The frontier is a durable queue*: both use cases start at a queue.
- *A host is asked before it is fetched*: Crawl page calls a cache before the websites; `"Host busy"` never fetches and puts the URL back in a queue before acknowledging.
- *A URL leaves the frontier only once its page is stored*: `"Host ready"` stores the page before acknowledging; `"Fetch failed"` shows the failed fetch and puts the URL back.
- *Links are deduplicated before they reach the frontier*: Parse links checks a cache or database before it writes to a queue, and never fetches.

## Back-of-the-envelope

```numbers
1.8k/s | pages fetched (about 4.5 billion a month)
180 MB/s | downloaded, about 470 TB a month
90k/s | links to deduplicate
5.4k/s | new URLs into the frontier
≈ 12 GB | Bloom filter for 10B URLs at 1%
≈ 540 | fetches in flight
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Pages fetched | 2k × 88% | about 1.8k/s |
| Pages a month | 1.76k × 2.6M s | about 4.5 billion |
| Bytes downloaded | 1.8k × 100 KB | 180 MB/s, about 470 TB a month |
| Links extracted | 1.8k × 50 | 90k/s |
| New URLs | 1.8k × 3 | 5.4k/s into the frontier |
| Seen set, exact | 10B URLs × 8-byte hash | 80 GB, plus overhead |
| Seen set, Bloom filter at 1% | 10B × 9.6 bits | about 12 GB |
| Concurrent fetches | 1.8k/s × 0.3 s (Little's law) | about 540 in flight |

**Throughput is the goal, not latency.** The p99 limits catch saturation: a fetcher pool or seen set that cannot keep up shows as a growing queue, and in the model as exploding latency.

**The fetchers move bytes.** Each page crosses a fetcher twice, in from the website and out to the page store: 360 MB/s through the pool, against 200 MB/s per service replica in the model. Bandwidth, not request count, sizes the fetchers. Little's law (in flight = rate × time each takes) gives about 540 fetches at once, so each fetcher holds many connections open with asynchronous I/O.

**The seen set is the busiest component.** 90k checks a second is close to one Redis node's 100k in the model, so it takes several nodes, enough to survive losing one. A database doing 90k conditional inserts a second costs several times more.

**The frontier grows.** 5.4k URLs a second go in, 1.8k come out. A real crawl never empties it; it prioritises (important URLs, often-changing pages) and drops or postpones the rest.

```quiz
littles-law-concurrency
```

## Concepts

### The URL frontier

The frontier is the crawler's to-do list and its most valuable state: weeks of discovery, billions of URLs. It must survive restarts, and hand work to many fetchers in parallel without giving one host to two of them.

A log such as Kafka partitioned by host does this: a host's URLs share a partition, one consumer owns each partition, so one fetcher owns each host. A URL not yet due goes back into the log with a due time (or into a delay queue).

```deepdive Mercator's two-layer frontier
The classic design (Mercator's) has two layers. *Front queues* order URLs by priority. *Back queues* hold one host each, and a fetcher thread drains one back queue at a time, so the frontier itself enforces one request per host. A log partitioned by host gives you much of that.
```

```callout pitfall A Redis list as the frontier
Tempting: fast and simple. But it keeps the whole frontier in memory, and a restart or a failover loses it.
```

### Politeness: one host at a time

Your crawler is a guest. Three rules keep it welcome:

| Rule | What it means |
|---|---|
| **robots.txt** | Fetch each host's robots.txt, cache it for a day or so, and never fetch what it disallows. It may also set a crawl delay. |
| **One connection per host, with a delay** | Commonly a few seconds, or a multiple of how long the last response took: a slow site gets crawled more slowly. |
| **Back off on errors** | A host that answers 429 or 503, or times out, gets its delay doubled. |

At 2k URLs a second, keep a small record per host (robots rules, earliest next fetch, current delay) in a fast store. Before fetching, read it: if the host is due, set the next allowed time and fetch; if not, put the URL back.

```callout tip It is a rate limiter
The per-host record is a rate limiter keyed by host: the same idea as a per-user token bucket with a capacity of one.
```

````deepdive In Proschi: rate-limited outbound calls
```proschi
title "Rate-limited outbound calls"

jobs    "Jobs"          [AWS SQS] x2
worker  "Sender"        [Worker]  x2
limits  "Partner limits" [Redis]  x2
partner "Partner API"   [Third Party API]

jobs   -> worker  : deliver
worker -> limits  : check partner budget
worker -> partner : call

usecase "Send to partner" {
  jobs     -> worker  : job 81
  worker   -> limits  : INCR partner:7:second
  limits  --> worker  : 3 of 5
  worker   -> partner : POST /events
  partner --> worker  : 202
  worker  --> jobs    : delete message
}
```
````

### Deduplicating URLs with a Bloom filter

Most links point to pages already crawled or queued: navigation bars, footers, an article linked from fifty places. Without deduplication the frontier fills with copies and pages are downloaded again.

```callout takeaway
Deduplicate **before** the frontier, when links are found. Checking at fetch time means you already paid to store and move the duplicate.
```

*Normalise* each URL (lowercase the host, drop the fragment, sort or strip tracking parameters), hash it, and ask: seen before?

- An **exact set** of 8-byte hashes for 10 billion URLs is about 80 GB before overhead: possible across several cache nodes.
- A **Bloom filter** answers with a bit array and k hash functions: "definitely not seen" or "probably seen". At a 1% false-positive rate it needs about 9.6 bits per URL, about 12 GB for 10 billion. A false positive skips one new URL: cheap, since a page that matters is usually linked from elsewhere too.

A database table of seen URLs works, expensively: 90k conditional inserts a second need many nodes, paying for durability the set does not need, since a lost filter can be rebuilt from the frontier and the page store.

Content can repeat under different URLs (mirrors, session ids). A hash of the page body, or a SimHash for near duplicates, catches those after the fetch.

```quiz
bloom-filter
bloom-filter-memory
```

### At-least-once crawling

Where you acknowledge a URL decides what a crash does. Commit on receipt, and a crash mid-download loses it for good. Commit after the page is stored, and a crash redelivers it and fetches the page twice.

That is *at-least-once*, the right default: a duplicate fetch costs a little bandwidth, and storing a page under the hash of its URL makes the second write harmless (*idempotent*). The same holds for a URL going back to the frontier (busy host, failed fetch): commit only after the re-enqueue is acknowledged.

### Failures and retries

At billions of fetches a month, failure is constant: DNS errors, timeouts, resets, 5xx, pages that never finish. So a failed fetch is a normal scenario: record it, raise the host's delay (exponential backoff), and put the URL back with a retry count; after a few attempts, drop it until the next crawl cycle.

Set a short timeout too: a slow host should cost a fetcher seconds, not minutes. In the model, the `-x` call to the websites followed by a successful re-enqueue is a *fallback*: the use case completes, so a website's 99.9% does not cap the crawler's availability.

```quiz
offset-commit-timing
backoff-with-jitter
```

## Designing it step by step

**1. Clarify.** Pages a month (4.5 billion, about 1.8k a second), page size (100 KB), what is stored (raw HTML), politeness rules, re-crawl frequency (out of scope) and JavaScript rendering (no).

**2. Draw the loop.** Frontier → fetchers → page store → queue of fetched pages → parsers → seen set → frontier. Two consumer pools, each acknowledging its input only when its output is safely written.

**3. Fetch path.** Read the host's record. Due: set the next allowed time, fetch, store the page, publish an event for the parsers, commit. Not due: re-enqueue with a due time, commit. Fetch failed: back off, re-enqueue with a retry count, commit.

**4. Parse path.** Read the page from the store, extract and normalise links, check all of them (`x50`) against the seen set, enqueue the ~3 new ones (`x3`) partitioned by host, commit.

**5. Size it.** Fetchers by bandwidth (360 MB/s) and the seen set for 90k operations, each with one node lost; at least two of everything else. Add up the bill.

**6. Wrap up.** Prioritisation and re-crawl scheduling (often-changing pages first), DNS caching (resolution is slow and resolvers rate-limit), spider traps (infinite calendars: cap depth and URLs per host), content deduplication.

## Common mistakes

**No politeness** (`wrong/no-politeness`). Fetchers download whatever they get, as fast as they can: fastest on paper, blocked in practice by small sites hit with bursts of parallel requests. It fails *A host is asked before it is fetched*.

**Enqueueing every link** (`wrong/enqueue-every-link`). Without a seen set, all 50 links per page enter the frontier: 90k writes a second, mostly duplicates fetched again. It fails *Links are deduplicated before they reach the frontier*, and with the frontier that busy, losing one of its nodes pushes Parse links past 200 ms (`survive any node failure`).

**A database as the seen set** (`wrong/seen-urls-in-a-database`). Correct, durable and about $6,150 a month instead of $2,600, because eight NoSQL nodes are needed for 90k conditional inserts a second. It fails the budget.

**The frontier in Redis** (`wrong/frontier-in-redis`). Fast, until a restart loses billions of URLs and every re-enqueued one. It fails *The frontier is a durable queue* and `Crawl page is durable`.

**Acknowledging before storing** (`wrong/ack-before-store`). Committing the URL on receipt means a crash, or a site that times out, loses it forever. It fails *A URL leaves the frontier only once its page is stored* and `Crawl page is durable`.

**Others.** Deduplicating at fetch time; one global FIFO queue, which sends a burst of fetchers to one host whenever a page links to its own site; no fetch timeout, so slow hosts tie up the pool.

## In the interview

Open with the loop and two invariants, then the sizing numbers: 1.8k pages a second, 90k links a second to deduplicate, 180 MB/s downloaded.

```callout interview Two invariants
"Nothing is lost: a URL leaves the frontier only when its outcome is written. Nobody is hammered: one fetcher per host, robots.txt and a delay."
```

Likely follow-ups:

- *What to crawl first?* Priority front queues: PageRank-like importance, past change frequency, freshness requirements.
- *Re-crawling?* Schedule each URL's next visit from its change history; pages that never change are visited rarely.
- *Spider traps?* Cap depth and pages per host, detect URL patterns that grow without end, and normalise URLs.
- *The Bloom filter is lost?* Rebuild it from the page store and frontier; meanwhile a few duplicates get through, which at-least-once already tolerates.
- *JavaScript-heavy sites?* A separate, much slower tier of headless browsers for the URLs that need it.
- *DNS?* A local caching resolver: lookups are slow and public resolvers limit you.

## Further reading

- [Mercator: A Scalable, Extensible Web Crawler](https://courses.cs.washington.edu/courses/cse454/15wi/papers/mercator.pdf), Heydon and Najork, 1999: the front and back queues, politeness per host and the URL-seen test.
- [Design a web crawler](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md), System Design Primer: a worked crawler with a links-to-crawl queue, a crawled-links store and duplicate detection.
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html): how robots.txt is fetched, parsed and cached.
- [Network Applications of Bloom Filters: A Survey](https://www.eecs.harvard.edu/~michaelm/postscripts/im2005b.pdf), Broder and Mitzenmacher: the false-positive arithmetic and uses like the crawler's seen set.
- *Introduction to Information Retrieval* (Manning, Raghavan and Schütze), chapter 20 "Web crawling and indexes".
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Web Crawler".
