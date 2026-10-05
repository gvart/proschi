---
title: Metrics Ingest
summary: "Uber's M3: aggregate before storage, quorum writes to a replicated time series store."
difficulty: hard
company: Uber
tags: [streaming, aggregation, replication, sharding, write-heavy, real-world]
hints:
  - "The storage cluster is fixed and can take only a fraction of the raw datapoints. Most of them are never queried at full detail: what could shrink them before they are stored?"
  - "Put an aggregation tier between the hosts and M3DB. It answers a batch as soon as the datapoints are in its open windows in memory, and writes the rolled-up result later, once per resolution, in \"Flush aggregates\"."
  - "M3DB keeps every shard on three replicas. Write all three (x3) and answer on a majority; in \"Replica down\", write two (x2), let the third fail (-x) and still answer. Queries go through a query tier, never straight from Grafana to M3DB."
  - "Size the aggregators for 20k batches a second at well under 70% busy (about 2k rps per replica) and keep them under 100% with one lost; the query tier needs only a few replicas. The budget has little room for more."
---

Uber's metrics platform, M3, collects everything its services and hosts
measure. In 2018 it took in **500 million metrics a second** across Uber
and kept **6.6 billion time series**. It did not store all of those
datapoints: an aggregation tier rolled them up first (dropping tags such as
the host that nobody queries, and downsampling to the resolutions each
namespace keeps), so only **20 million a second** reached storage. Storage
is M3DB, a distributed time series database that keeps each shard on three
replicas and writes with a quorum. Queries in PromQL or M3QL go through a
query service.

Design one region's slice of it. The M3DB cluster is given, and it is
fixed: you cannot add replicas or shards to it.

## Functional requirements

- **Emit metrics**: a host's collector (Prometheus and the M3 collector)
  sends a batch of 2,000 datapoints and gets `200`. Losing a few seconds of
  datapoints when an aggregator dies is acceptable; slowing the hosts down
  is not.
- **Flush aggregates**: when a window closes (at each resolution's
  boundary), an aggregator writes the aggregated datapoints to M3DB. The
  write goes to all three replicas of the shard and succeeds on a majority.
  Two scenarios: `"All replicas up"`, and `"Replica down"`, where one
  replica does not answer and the write still succeeds on the other two.
- **Query**: a dashboard panel or an alert asks for a series over a time
  range, through a query service that reads M3DB and computes the result.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **40 million datapoints a second** into this slice, in batches of 2,000:
  **20k batches per second**.
- Aggregation keeps about **one datapoint in 25**, Uber's ratio of 500
  million to 20 million: **1.6 million a second**, or **800 batch writes per
  second**, each to three replicas.
- About **0.1%** of flushes find a replica of their shard down.
- **1k queries per second** from dashboards and alerts, each reading about
  two series blocks.

## Constraints

- A collector's batch never waits for storage: the Emit metrics path calls
  no database.
- Hosts never write M3DB themselves; only aggregated datapoints reach it.
- The M3DB cluster is fixed: two shards of three replicas, each replica
  taking **2k writes** and **5k reads** a second, at **$700 / month**.
- A flush is durable once a majority of replicas has it, and a replica
  that is down must not fail it.
- Grafana and the alerts never talk to M3DB directly.
- p99 of **Emit metrics** under **40 ms**, of **Query** under **80 ms**.
- Emit metrics available **99.99%** of the time, Query **99.9%**.
- Losing any single machine must not break a latency limit.
- At most **$7,500 / month**, the M3DB cluster included.

## What is given

`problem.proschi` declares the `collectors` and `grafana` (the clients) and
`m3db`, the storage cluster, with its fixed capacity, and holds the
traffic, requirements and tests. Add the aggregation tier, the query tier,
the connections and the three use cases.

The simulation cannot express "two of three": write a majority write as
`x3` (every replica gets the write) and a replica that is down as `x2` and
a failed call (`-x`). It does not model the windows themselves either: an
aggregator holding datapoints in memory is simply a call that touches
nothing else.

## Based on

- [M3: Uber's Open Source, Large-scale Metrics Platform for Prometheus](https://www.uber.com/blog/m3/),
  Uber Engineering, August 2018: 500 million metrics a second aggregated
  and 20 million a second persisted to M3DB with a quorum write to three
  replicas in a region, 6.6 billion time series, the M3 Aggregator's
  stream-based downsampling by rules, and the M3 Coordinator and M3 Query
  in front of M3DB.
- [The Billion Data Point Challenge: Building a Query Engine for High Cardinality Time Series Data](https://www.uber.com/blog/billion-data-point-challenge/),
  Uber Engineering, December 2018: M3's query engine at about 2,500 queries
  and 8.5 billion datapoints a second.
- The M3 documentation on [consistency levels](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/consistencylevels.md)
  (writes at `one`, `majority` or `all`) and
  [sharding](https://github.com/m3db/m3/blob/master/site/content/architecture/m3db/sharding.md)
  (series hashed to a fixed set of virtual shards, each placed on every
  replica).

The posts give global rates; the slice's rates, the batch size and the
cluster's per-replica capacity are assumptions for this exercise.
