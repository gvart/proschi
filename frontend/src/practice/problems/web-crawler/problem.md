---
title: Web Crawler
summary: A polite crawler with a durable frontier, per-host rate limits and a Bloom filter for seen URLs.
difficulty: medium
tags: [queues, rate-limiting, probabilistic, external-api, object-storage, durability]
hints:
  - "The crawl is a loop of two consumers: fetchers take URLs from a frontier and store pages; parsers read stored pages, extract links and feed the new ones back into the frontier. The frontier must survive a restart: it is weeks of work."
  - "Before every fetch, look up the host: robots.txt rules and the earliest time it may be fetched again, kept in a fast store. If it is not due, put the URL back in the frontier with a due time instead of fetching it."
  - "A page has about 50 links and almost all were seen before. Check each one against a seen-URL set (x50 against a Bloom filter in memory) before anything goes into the frontier, and enqueue only the ~3 new ones."
  - "Commit a URL to the frontier only after its page is stored or the URL is back in the frontier for a retry. When a site times out (-x), back off and retry later. Size the seen set for 90k checks a second with a replica lost, and mind the budget."
---

Design the crawler behind a search engine's index: it starts from a few
seed URLs, downloads pages, finds the links in them and keeps going, for
billions of pages a month. It must be **polite**: a website that the
crawler hammers blocks it, or goes down.

## Functional requirements

- **Crawl page**: a fetcher takes the next URL from the frontier (the
  queue of URLs still to crawl) and, if the host is ready, downloads the
  page and stores it. Three scenarios:
  - `"Host ready"`: robots.txt allows the URL and the host's crawl delay
    has passed: the page is fetched and stored, and the parsers are told.
  - `"Fetch failed"`: the site times out or refuses the connection: the URL
    goes back to the frontier to be retried later, with a backoff.
  - `"Host busy"`: the host was fetched less than its crawl delay ago: the
    URL goes back to the frontier, due when the host is.
- **Parse links**: a parser reads a stored page, extracts its links, drops
  the ones the crawler has already seen and adds the new ones to the
  frontier.

Use these use case and scenario names exactly: the traffic, requirements
and tests in `problem.proschi` refer to them.

## Scale

- **Crawl page: 2k rps**: 88% of them fetch a page (**about 1.8k pages a
  second**, 4.5 billion a month), 2% fail and 10% find the host busy.
- **Parse links: 1.8k rps**, one per stored page.
- A page is about **100 KB** of HTML, and a fetch takes about **300 ms**.
- A page has about **50 links**; about **3 of them** are URLs the crawler
  has never seen.
- About 10 billion URLs are known, on 100 million hosts.

## Constraints

- The frontier is durable: a restart or the loss of a machine loses no URL.
- A URL leaves the frontier only once its page is stored, or once it is
  back in the frontier for a retry.
- Polite: at most one request to a host at a time, never sooner than its
  crawl delay, and never against its robots.txt. A URL of a host that is
  not ready is put back, not dropped.
- Links are deduplicated before they reach the frontier.
- p99 of **Crawl page** under **1.5 s**, of **Parse links** under **200 ms**.
- Every use case available **99.9%** of the time; websites fail, the
  crawler must not.
- Losing any single machine must not take the crawler down.
- At most **$4,000 / month**, page storage included.

## What is given

`problem.proschi` declares `web`, the websites (an external system that
answers a fetch in about 300 ms), and holds the traffic, requirements and
tests. Add the frontier, the fetchers, the per-host state, the page store,
the parsers, the seen-URL set, the connections and the two use cases. Both
use cases start where the work waits: the frontier hands a URL to a
fetcher, and a queue of fetched pages hands a page to a parser; each is
acknowledged (the response to that first step) when the work is done.
