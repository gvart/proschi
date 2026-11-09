---
title: Read Replicas
summary: "Shopify's MySQL: reads spread over replicas behind ProxySQL, writes and fresh reads on the primary."
difficulty: medium
company: Shopify
tags: [replication, read-heavy, real-world]
hints:
  - "Count the load first: 60k reads and 3k writes a second. A MySQL primary takes about 5k writes, so the writes fit on one. What about the reads?"
  - "A replica holds a full copy of the data and can answer any read, but replication is asynchronous: it may be a little behind. Which of the three use cases can live with that, and which cannot?"
  - "Add a second MySQL node for the replicas, send Read catalog to it through the proxy, and keep Place order and Check order on the primary. A MySQL replica serves about 20k reads a second."
  - "Size the pool for losing one replica: at 60k reads, four replicas run at 75% but three would be full, so use five. Six break the budget, and sharding the primary only adds primaries the writes do not need."
---

Shopify runs on MySQL. For years its replicas were there only for
redundancy and failover; then Shopify began reading from them, to serve
read-heavy applications faster and to take load off the primaries, which
are needed for writes and time-sensitive reads. Applications reach MySQL
through ProxySQL, a proxy that groups interchangeable servers and picks
one for each query, so the application never needs to know the topology.

Replicas copy the primary asynchronously, so a replica can be seconds (or
more) behind. The design question is which reads may go to a replica and
how many replicas the read load needs.

## Functional requirements

- **Read catalog**: a storefront page reads a shop's products. Showing a
  product change a few seconds late is acceptable.
- **Place order**: checkout writes the order to MySQL before answering.
- **Check order**: the order status page, opened right after checkout,
  reads the order just placed. It must find it.

Every query goes from `app` through `proxy` to MySQL. Use these use case
names exactly: the traffic, requirements and tests in `problem.proschi`
refer to them.

## Scale

- **60k catalog reads**, **3k orders** and **2k order checks** per second
  at peak. Shopify does not publish these rates; they are assumptions for
  the exercise.

## Constraints

- Every query goes through ProxySQL: no connection from the app to a
  database.
- Catalog reads come from MySQL replicas, not from the primary or a cache.
- Writes and reads that must see the latest write go to the primary.
- p99 of **Read catalog** under **40 ms**; of **Place order** and
  **Check order** under **80 ms**.
- Every use case available **99.95%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$3,400 / month**, the proxies and the primary included.

## What is given

`problem.proschi` declares `app`, Shopify's application servers (the client
of this problem), `proxy`, three ProxySQL instances, and `primary`, the
MySQL primary with a standby that takes over if it fails. Add the replica
pool as one MySQL node, connect it, and write the three use cases.

## What this model leaves out

- Replication lag is not simulated: a replica in the model is always up to
  date. The flow test asks for the fresh read to go to the primary instead.
- Monotonic reads are not simulated either. Shopify's fix, hashing an id
  shared by related queries to pick the same replica each time, changes
  which replica answers, not how much load the pool carries.
- ProxySQL in reality also weighs latency and load when it picks a server;
  here the load is spread evenly over the replicas.
- Failover of the primary is a fixed share of its downtime, and a replica
  that is down simply carries no load; nothing is lost in either.

## Based on

- Thomas Saunders, [Read consistency with database replicas](https://shopify.engineering/read-consistency-database-replicas),
  Shopify Engineering blog, February 2021: replicas first kept for
  redundancy and failover, then used as read-only sources to serve
  read-heavy applications and take load off the primaries, which are needed
  for time-sensitive reads and writes; ProxySQL in front of MySQL, grouping
  interchangeable servers into hostgroups and choosing a server per query;
  lag of seconds or minutes; tight and causal (GTID-based) consistency
  considered and set aside; and monotonic reads by hashing an opt-in
  `consistent_read_id` comment to one replica, indexing into the full
  server list so a replica outage only moves the ids it served.
