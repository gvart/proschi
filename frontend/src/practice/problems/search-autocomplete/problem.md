---
title: Search Autocomplete
summary: Precomputed suggestions at the edge, rebuilt asynchronously.
difficulty: medium
tags: [caching, cdn, read-heavy, batch]
hints:
  - The search cluster handles 9k rps and suggestions come at 100k rps. What could answer a prefix without searching at all?
  - "The top ten of a prefix changes slowly: compute it ahead of time from the query log and keep it in an in-memory store keyed by prefix."
  - Most keystrokes are for a few popular prefixes. A CDN can answer those for a few minutes without reaching your servers, which is what makes the budget work.
  - "A search answers from the search cluster and appends the query to the log with ->>: Kafka is never on the path of the response. The rebuild starts with a step sent by the scheduler."
  - "Size the Suggest Service for the edge misses only (20k rps) and keep it near 50% busy: its queueing delay decides the p99."
---

A shop's search box should suggest completions while the user
types: after `ipho` it shows *iphone 15*, *iphone case*, *iphone charger*.
Every keystroke is a request, so suggestions are read far more often than
anything else and must feel instant. The ten best completions of a prefix are
the ones searched most often recently; they change slowly, so they can be
computed ahead of time.

## Functional requirements

- **Suggest**: the search box sends `GET /suggest?q=<prefix>` and gets the
  top ten completions of the prefix. Model it with two scenarios:
  - `"Edge hit"`: the prefix is popular and the CDN (a real CDN, not a load
    balancer) answers from its cache (suggestions may be up to 5 minutes old).
  - `"Edge miss"`: the CDN passes the request on and the top ten are read
    from the precomputed suggestion index, kept in memory.
- **Search**: the user submits a query and gets results from the search
  cluster. Every query is appended to a query log for the index to learn from;
  logging must never slow a search down, so the API does not wait for the log.
- **Rebuild index**: every 15 minutes the scheduler starts a rebuild (its
  first step is sent by `scheduler`), which
  reads the recent queries from the query log, counts them per prefix and
  writes the new top ten of every prefix into the suggestion index.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- Suggestions: **100k rps** at peak; 80% of them are for popular prefixes
  the CDN can cache.
- Searches: **2k rps**.
- About 5 million distinct prefixes with ten completions each: a few GB, small
  enough to keep in memory.

## Constraints

- p99 of a suggestion under **100 ms**; of a search under **300 ms**.
- Suggestions available **99.95%** of the time.
- The search cluster is sized for searches only (about 9k rps); suggestions
  must never reach it, nor any database.
- Losing any single machine must not take either use case down.
- At most **$5,500 / month**, the search cluster and the scheduler included.

## What is given

`problem.proschi` declares the `user`, the existing search cluster
`search` (three Elasticsearch nodes) and the `scheduler` that starts the
rebuild, and holds the traffic, requirements and tests. Add the suggestion
path, the query log, the index builder, the connections and the three use
cases.
