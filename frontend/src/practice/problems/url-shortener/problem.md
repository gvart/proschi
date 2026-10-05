---
title: URL Shortener
summary: Cache-first redirects that survive losing any single machine.
difficulty: easy
tags: [caching, read-heavy, durability]
hints:
  - Redirects outnumber shortening 100 to 1. What can answer a redirect without touching the database?
  - "On a miss, read the database, then SET the code in the cache (->> is fine), so the next visitor hits. p99 is taken over all redirects, hits and misses mixed by their share: the 5% of misses decide it."
  - "One instance of anything is a single point of failure: use x2 or more on every component."
  - A REST API handles about 2k rps per replica in the simulation; size the API so it stays well below 70% busy.
---

Design a service that turns long URLs into short codes and sends
visitors who open a short link to the original URL.

## Functional requirements

- **Shorten**: a visitor posts a long URL and gets a short code back.
- **Redirect**: a visitor opens `/<code>` and is redirected (`302`) to the
  long URL. Name its two scenarios `"Cache hit"` and `"Cache miss"`. A
  cache miss reads the code from the database and puts it in the cache, so
  the next visitor hits.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- Redirects: **10k rps**, 95% of them for codes that were opened recently.
- Shortening: **100 rps**.

## Constraints

- p99 of a redirect under **50 ms**, of shortening under **200 ms**.
- Redirects available **99.9%** of the time.
- A short code is never lost once it has been returned to the visitor: it
  is written (`INSERT`, `PutItem`, …) to a database before the answer.
- Losing any single machine must not take the service down.
- At most **$3,000 / month**.

## What is given

`problem.proschi` declares the `visitor` and holds the traffic,
requirements and tests. Your file imports it; add the components,
connections and the two use cases.
