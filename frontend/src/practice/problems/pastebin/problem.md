---
title: Pastebin
summary: Object storage for bodies, a CDN for hot reads.
difficulty: easy
tags: [object-storage, cdn, read-heavy]
hints:
  - Pastes can be 10 MB and add up to 80 TB. Which kind of store is built for large blobs, and what is left for the database?
  - Reads come in bursts for the same link, and a popular paste must load in 30 ms. What can answer them before they reach your servers at all?
  - "Look up the paste row first: it tells you whether the paste expired, so an expired read never fetches the text."
  - "Write ~10KB on the steps that carry the text. Text the CDN sends to readers costs $0.02/GB; sent by your API it would cost $0.09/GB. The \"Not cached\" path (9% of reads) decides p99: it waits for the CDN, the API, the database and object storage (~30 ms) one after the other."
---

Design a service where people paste a block of text (a log, a stack
trace, a config file), get a short link back and share it. Anyone with the
link can read the paste until it expires.

## Functional requirements

- **Create paste**: a user posts the text and an optional expiry (one hour
  to one year) and gets a short id back (`201`).
- **Read paste**: anyone opens `/<id>` and gets the text. Name its three
  scenarios:
  - `"Cached"`: the paste was read recently and the CDN answers it from
    its edge cache.
  - `"Not cached"`: the paste has to be looked up and fetched.
  - `"Expired"`: the paste exists but has expired; the reader gets `404`
    and its text is never fetched.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **50 pastes per second** are created, at peak.
- Reads: **5k rps**, 90% of them for pastes that were read in the last few
  minutes (a link shared in a chat gets opened by everybody at once); 1% are
  for expired pastes.
- A paste is 10 KB on average and up to **10 MB**. Five years of pastes add
  up to about 80 TB.
- 5k reads a second of 10 KB each send about **130 TB a month** to readers.
  Put the size on every step that carries the text (`~10KB`), so the
  simulation counts its transfer time and egress: data sent to readers
  costs **$0.02/GB** from a CDN and **$0.09/GB** from anything else you
  run; copies inside the system (object storage to your API) are free.

## Constraints

- p99 of a read under **100 ms**, of creating a paste under **300 ms**.
- A popular paste (`"Cached"`) loads in under **30 ms** at p99: only an
  edge close to the reader is that fast.
- Reads available **99.9%** of the time.
- A paste is never lost once its id has been returned.
- Losing any single machine must not take the service down.
- At most **$6,000 / month**, egress included.

## What is given

`problem.proschi` declares the `user` and holds the traffic, requirements
and tests. Add the components, the connections and the two use cases.
