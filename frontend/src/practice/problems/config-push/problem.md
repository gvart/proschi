---
title: Config Distribution
summary: "Cloudflare's Quicksilver: config written once, sent down a tree, read locally on each edge server."
difficulty: medium
company: Cloudflare
tags: [replication, fan-out, read-heavy, availability, real-world]
hints:
  - "Edge requests read configuration 3M times a second, and the requirements say a data center must keep serving when the core is unreachable. Where can a read come from so that it never leaves the edge server?"
  - "Every change is written once, to the root (x2: a primary and a secondary), and the customer gets the answer as soon as the root has it. Copying it to the edge happens after the answer, with async sends (->>)."
  - "If the root sent each 2 KB change to all 200 data centers itself, it would send 400 MB/s, and a Key-Value Store node carries about 100 MB/s. Put a tier of main nodes (id mains) between the root and the local stores: the root sends one copy to each main node, and they feed the data centers. Write the fan-out with prefixes, such as ~2KB x200."
  - "Size the main tier for the bytes it sends out, so that it stays under 100% with one main node down, and check the budget: the main nodes are most of the cost."
---

Cloudflare's network answers millions of HTTP requests a second, and nearly
every one depends on configuration: the site's DNS records, its firewall
rules, its Workers, its certificates. A customer can change any of it at any
moment, and the change has to reach every machine in some 200 cities within
seconds. Requests cannot fetch configuration from a central place: each data
center must keep serving even when cut off from the core.

Cloudflare's answer is Quicksilver, a replicated key-value store. Writes go
to a single root, which numbers them in order. The changes are copied down a
tree, from the root to main nodes and from them to every edge server, which
keeps a full copy in a local LMDB file. A request reads that local copy and
never leaves the machine.

Design the distribution of one kind of configuration, customer settings.

## Functional requirements

- **Serve request**: a visitor sends a request to an edge server, which reads
  the site's settings (three lookups) from its local store and answers
  `200`.
- **Change config**: a customer changes a setting through the API and gets
  `200` once the change is stored durably. The change then reaches the local
  store of every data center, without the customer waiting for it.

Name the root `root` and the tier between it and the edge `mains`: the tests
in `problem.proschi` refer to them, and to the use case names above.

## Scale

- **1M requests per second** at the edge, each reading **3** settings
  (assumption: Cloudflare reports over 14M HTTP requests a second at peak
  and about 2.5 trillion Quicksilver reads a day; this is a slice of it).
- **1k configuration changes per second** at peak (assumption: Cloudflare
  reports about 30 million writes a day, 350 a second on average).
- Each change travels as a log entry of about **2 KB** (assumption).
- **200 data centers**, each with its own copy of the configuration.

## Constraints

- An edge request reads only its server's local store: never the root or
  the main nodes.
- A change is written once, to the root; the customer's answer does not wait
  for any copy below it.
- The root sends only to the main nodes, never to the data centers
  directly.
- Use `[Key-Value Store]` for the root and the main nodes: each node serves
  about **20k** operations a second, carries **100 MB/s** of traffic and
  costs **$500 / month**.
- p99 of **Serve request** under **20 ms**; of **Change config** under
  **100 ms**.
- Every use case available **99.99%** of the time.
- Losing any single machine, the root included, must not break a latency
  limit.
- At most **$5,000 / month**. The edge servers and their local stores are
  already paid for and cost nothing here.

## What is given

`problem.proschi` declares the `visitor`, the `customer`, the `edge`
servers and the `local` stores, one replica of each per data center, and
holds the traffic, requirements and tests. Add the config API, the root and
the main nodes, connect them, and write the two use cases.

## What this model leaves out

- **Propagation time.** Cloudflare's measure of success is how fast a
  change reaches every machine: within seconds. The simulation has no clock
  for work done after the answer, so async copies count as load and
  bandwidth only, never as time.
- **Batching.** Quicksilver commits all the updates of a 500 ms window in
  one disk write. The model counts one write per change per store.
- **Pull, not push.** In Quicksilver each node asks its parent for the
  entries after the last one it has. The model draws the copy as a send
  from parent to child, which loads the same nodes with the same bytes.
- **Sequence numbers and catch-up.** Gap detection, the longer history the
  secondary main nodes keep so a machine can be offline for a week, and
  replication lag are not simulated: a local store is always current.
- **Size.** One replica of `edge` and `local` stands for a data center's
  servers and copies; Cloudflare runs over 90,000 database instances on
  thousands of servers.

## Based on

- Geoffrey Plouviez, [Introducing Quicksilver: Configuration Distribution at Internet Scale](https://blog.cloudflare.com/introducing-quicksilver-configuration-distribution-at-internet-scale/),
  Cloudflare blog, March 2020: configuration distributed to 200 cities in 90
  countries within seconds; each data center able to serve while cut off
  from central configuration; the Kyoto Tycoon system it replaced (root
  nodes, management nodes per data center, a copy on each server) and why;
  LMDB as the local store, queried from every edge server with low read
  latency; the fan-out from nodes to main nodes to top-mains; a single data
  center aggregating writes behind a monotonically increasing sequence
  number; 500 ms write batching; primary and secondary servers, with
  secondary mains keeping a week of history; and about 2.5 trillion reads
  and 30 million writes a day on over 90,000 database instances. The
  request and change rates, the 2 KB entry and the node figures here are
  assumptions.
