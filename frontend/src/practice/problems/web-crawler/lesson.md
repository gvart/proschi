# Web Crawler: a polite loop that never forgets a URL

A crawler looks like the simplest program in the world: download a page, find its links, download those. At a few billion pages a month it turns into a lesson on queues. The work list grows faster than you can work through it, almost every link you find is one you have seen, and the websites on the other end are someone else's servers that you must not knock over. This lesson builds the loop out of a durable frontier, a per-host politeness check, a Bloom filter and two pools of consumers.

## What you'll learn

- What the URL frontier is, why it must be durable, and why it is partitioned by host.
- How per-host politeness works: robots.txt, crawl delays and putting a URL back instead of fetching it.
- How a Bloom filter deduplicates 90k links a second in a few gigabytes of memory, and what its false positives cost.
- Why the crawl is at-least-once, and where to acknowledge a URL so that a crash loses nothing.
- How to treat failing websites as normal: timeouts, backoff and retries.

## The problem, explained

**Who uses it.** A search engine's indexing pipeline, which wants fresh copies of billions of pages; nobody waits on a single fetch, but the crawl rate decides how fresh the index is.

**Functional requirements.**

- **Crawl page**: a fetcher takes a URL from the frontier and either fetches and stores the page (`"Host ready"`), puts the URL back after the site failed (`"Fetch failed"`), or puts it back because the host is not due yet (`"Host busy"`).
- **Parse links**: a parser reads a stored page, extracts the links, drops the seen ones and adds the new ones to the frontier.

**Non-functional requirements.** The frontier is durable, and a URL leaves it only once its page is stored or it is back for a retry. At most one request to a host at a time, never before its crawl delay, never against robots.txt. Links deduplicated before the frontier. p99 (the latency 99% of requests beat) under 1.5 s for a crawl step and 200 ms for parsing. Available 99.9% even though websites fail. Any machine can fail. At most $4,000 a month.

**What is given, and why.** `given.proschi` declares the websites as one external system that answers in about 300 ms. Websites are not yours: they are slow, they fail, and their availability is not something you can add replicas to. The crawler has to be reliable around them.

**What the tests check.**

- *The frontier is a durable queue*: both use cases start at a queue.
- *A host is asked before it is fetched*: Crawl page calls a cache before the websites; `"Host busy"` never fetches and puts the URL back in a queue before acknowledging.
- *A URL leaves the frontier only once its page is stored*: `"Host ready"` stores the page before acknowledging; `"Fetch failed"` shows the failed fetch and puts the URL back.
- *Links are deduplicated before they reach the frontier*: Parse links checks a cache or database before it writes to a queue, and never fetches.

## Back-of-the-envelope

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

**Throughput is the goal, not latency.** Nobody waits for a crawl step. The p99 limits are there to catch saturation: a fetcher pool or a seen set that cannot keep up shows as a queue that grows, and in the model as a latency that explodes.

**The fetchers move bytes.** Each fetched page crosses a fetcher twice: in from the website and out to the page store. That is 360 MB/s through the pool, and the model gives a service replica 200 MB/s, so bandwidth, not request count, decides how many fetchers you need. Little's law (requests in flight = rate × time each takes) says about 540 fetches are in flight at once: each fetcher holds many connections open, which is why they are written with asynchronous I/O.

**The seen set is the busiest component.** 90k checks a second is close to one Redis node's 100k in the model, so it takes several nodes, and enough of them to survive losing one. A database doing 90k conditional inserts a second costs several times more.

**The frontier grows.** 5.4k new URLs a second go in and 1.8k pages a second come out. A real crawl never empties its frontier; it prioritises (which URLs matter most, which pages change often) and drops or postpones the rest.

## Concepts

### The URL frontier

The frontier is the crawler's to-do list, and it is the most valuable state the crawler has: weeks of discovery, billions of URLs. It must live in a durable store that survives restarts, and it must hand work to many fetchers in parallel without giving the same host to two of them.

The classic design (Mercator's) has two layers. *Front queues* order URLs by priority. *Back queues* hold one host each, and a fetcher thread drains one back queue at a time, so the frontier itself enforces one request per host. You get much of that by partitioning a log such as Kafka by host: every URL of a host lands in the same partition, one consumer owns each partition, and so one fetcher owns each host. A URL that is not due yet goes back into the log with a due time (or into a delay queue).

A Redis list is tempting, fast and simple. It also keeps the whole frontier in memory: a restart or a failover loses it.

### Politeness: one host at a time

Your crawler is a guest. Three rules keep it welcome:

1. **robots.txt.** Fetch each host's robots.txt, cache it for a day or so, and never fetch what it disallows. It may also set a crawl delay.
2. **One connection per host, with a delay between requests.** Commonly a few seconds, or a multiple of how long the last response took: a slow site gets crawled more slowly.
3. **Back off on errors.** A host that answers 429 or 503, or times out, gets its delay doubled.

To apply them at 2k URLs a second, keep a small record per host (robots rules, the earliest time of the next fetch, the current delay) in a fast store. Before fetching, read it. If the host is due, set the next allowed time and fetch; if not, put the URL back. It is a rate limiter keyed by host, the same idea as a per-user token bucket with a capacity of one.

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

### Deduplicating URLs with a Bloom filter

Most links point to pages you have already crawled or queued: navigation bars, footers, the same article linked from fifty places. Without deduplication the frontier fills with copies and fetchers download pages again. Deduplicate *before* the frontier, when links are found; checking at fetch time means you already paid to store and move the duplicate.

First *normalise* each URL (lowercase the host, drop the fragment, sort or strip tracking parameters), then hash it and ask: seen before?

- An **exact set** of 8-byte hashes for 10 billion URLs is about 80 GB before overhead: possible across several cache nodes.
- A **Bloom filter** answers with a bit array and k hash functions: "definitely not seen" or "probably seen". At a 1% false-positive rate it needs about 9.6 bits per URL, about 12 GB for 10 billion. A false positive means one new URL is skipped; for a crawler that is cheap, since a page that matters is usually linked from elsewhere too.

A database table of seen URLs works too, and it is the expensive answer: 90k conditional inserts a second need many nodes, sized for durability that the set does not need. If the filter is lost, it can be rebuilt from the frontier and the page store.

Content can repeat under different URLs (mirrors, session ids). A hash of the page body, or a SimHash for near duplicates, catches those after the fetch.

### At-least-once crawling

Where you acknowledge a URL decides what a crash does. If the fetcher commits the URL when it takes it, a crash mid-download loses the URL for good. If it commits after the page is stored, a crash means the URL is delivered again and the page fetched twice. That is *at-least-once* processing, and it is the right default: a duplicate fetch costs a little bandwidth, and storing a page under the hash of its URL makes the second write harmless (*idempotent*).

The same rule covers the other outcomes: a URL that goes back to the frontier (busy host, failed fetch) is committed only after the re-enqueue is acknowledged.

### Failures and retries

At billions of fetches a month, failure is constant: DNS errors, timeouts, resets, 5xx, pages that never finish. The crawler's availability cannot depend on any website's. So a failed fetch is a normal scenario: record it, raise the host's delay (exponential backoff), and put the URL back with a retry count; after a few attempts, drop it until the next crawl cycle. Set a short timeout too, since a slow host should cost a fetcher a few seconds at most, not minutes. In the model, the `-x` call to the websites followed by a successful re-enqueue is a *fallback*: the use case still completes, so a website's 99.9% does not cap the crawler's availability.

## Designing it step by step

**1. Clarify.** Pages a month (4.5 billion, so about 1.8k a second), page size (100 KB), what is stored (raw HTML), politeness rules, how often pages are re-crawled (out of scope here), and whether we handle JavaScript rendering (no).

**2. Draw the loop.** Frontier → fetchers → page store → queue of fetched pages → parsers → seen set → frontier. Two consumer pools, each acknowledging its input only when its output is safely written.

**3. Fetch path.** Read the host's record; if due, set the next allowed time, fetch, store the page, publish an event for the parsers, commit. If not due, re-enqueue with a due time and commit. If the fetch fails, back off, re-enqueue with a retry count and commit.

**4. Parse path.** Read the page from the store, extract and normalise links, check all of them (`x50`) against the seen set, enqueue the ~3 new ones (`x3`) partitioned by host, commit.

**5. Size it.** Fetchers by bandwidth (360 MB/s through the pool) with one lost; the seen set for 90k operations with one node lost; the page store, queues and host store with at least two of everything. Add up the bill.

**6. Wrap up.** Prioritisation and re-crawl scheduling (pages that change often first), DNS caching (resolution is slow and resolvers rate-limit), spider traps (infinite calendars: cap depth and URLs per host), and content deduplication.

## Common mistakes

**No politeness** (`wrong/no-politeness`). Fetchers download whatever they get, as fast as they can. On paper it is the fastest crawler; in practice small sites see bursts of parallel requests and block it. It fails *A host is asked before it is fetched*.

**Enqueueing every link** (`wrong/enqueue-every-link`). Without a seen set, all 50 links per page go into the frontier: 90k writes a second, mostly duplicates that will be fetched again. It fails *Links are deduplicated before they reach the frontier*, and with the frontier that busy, losing one of its nodes pushes Parse links past 200 ms (`survive any node failure`).

**A database as the seen set** (`wrong/seen-urls-in-a-database`). Correct, durable and about $6,150 a month instead of $2,600, because eight NoSQL nodes are needed for 90k conditional inserts a second. It fails the budget.

**The frontier in Redis** (`wrong/frontier-in-redis`). Fast, until a restart loses billions of URLs and every re-enqueued one. It fails *The frontier is a durable queue* and `Crawl page is durable`.

**Acknowledging before storing** (`wrong/ack-before-store`). Committing the URL on receipt means a crash, or a site that times out, loses it forever. It fails *A URL leaves the frontier only once its page is stored* and `Crawl page is durable`.

**Others.** Deduplicating at fetch time; one global FIFO queue, which sends a burst of fetchers to the same host whenever a page links to its own site; and no timeout on fetches, so slow hosts tie up the pool.

## In the interview

Open with the loop and the two invariants: "Nothing is lost: a URL leaves the frontier only when its outcome is written. Nobody is hammered: one fetcher per host, robots.txt and a delay." Then do the numbers that size things: 1.8k pages a second, 90k links a second to deduplicate, 180 MB/s downloaded.

Likely follow-ups:

- *How do you decide what to crawl first?* Priority front queues: PageRank-like importance, how often the page changed before, and freshness requirements.
- *How do you re-crawl?* Schedule each URL's next visit from its change history; pages that never change are visited rarely.
- *Spider traps?* Cap depth and pages per host, detect URL patterns that grow without end, and normalise URLs.
- *What if the Bloom filter is lost?* Rebuild it from the page store and frontier; meanwhile a few duplicates get through, which at-least-once already tolerates.
- *JavaScript-heavy sites?* A separate, much slower rendering tier with headless browsers, for the URLs that need it.
- *DNS?* A local caching resolver, since DNS lookups are slow and public resolvers limit you.

## Further reading

- [Mercator: A Scalable, Extensible Web Crawler](https://courses.cs.washington.edu/courses/cse454/15wi/papers/mercator.pdf), Heydon and Najork, 1999: the front and back queues, politeness per host and the URL-seen test.
- [Design a web crawler](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md), System Design Primer: a worked crawler with a links-to-crawl queue, a crawled-links store and duplicate detection.
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html): how robots.txt is fetched, parsed and cached.
- [Network Applications of Bloom Filters: A Survey](https://www.eecs.harvard.edu/~michaelm/postscripts/im2005b.pdf), Broder and Mitzenmacher: the false-positive arithmetic and uses like the crawler's seen set.
- *Introduction to Information Retrieval* (Manning, Raghavan and Schütze), chapter 20 "Web crawling and indexes".
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Web Crawler".
