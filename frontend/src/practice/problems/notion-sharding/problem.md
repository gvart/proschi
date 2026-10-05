---
title: Notion Sharding
summary: "Notion's Postgres: 480 logical shards by workspace on 32 databases, behind PgBouncer."
difficulty: medium
company: Notion
tags: [sharding, write-heavy, real-world]
hints:
  - "Read replicas copy every write, so they add read capacity only: every edit still goes to one primary. What gives you more primaries?"
  - "Split the data so that the queries you run most touch one shard. Everything in Notion (blocks, comments, discussions) belongs to a workspace, and a page load or an edit asks about one workspace. Partition by workspace id."
  - "A PostgreSQL primary takes about 5k writes a second. 100k edits a second need at least 20 primaries; to keep the p99 under 70 ms each should stay near 65% busy. Set the shard count with capacity { db shards N } and give each shard a replica (x2) for failover."
  - "Notion settled on 32 physical databases holding 480 logical shards (15 schemas each); 480 divides evenly into 32, 48, 96 or 120 databases, so later growth moves whole schemas. Every query goes web → pgbouncer → db, one shard per query; three replicas per shard break the budget."
---

Until 2021 Notion kept every block (each paragraph, heading, to-do and page
is a block) in one PostgreSQL database. It held over 20 billion rows and was
running out of room: VACUUM stalled, and transaction id wraparound was
approaching, after which Postgres stops taking writes. A bigger machine
would only buy months.

So Notion split the database. The hard decision is the **partition key**:
the column that decides which shard a row lives on. A good key keeps the
data a request needs on one shard and spreads the load evenly.

## Functional requirements

- **Load page**: a user opens a page, and the API reads its blocks.
- **Edit block**: a user types into a block, and the change is written to
  Postgres before the API answers.

The API servers decide which shard a query goes to and send it through
`pgbouncer`, which pools their connections to Postgres. Use these use case
names exactly: the traffic, requirements and tests in `problem.proschi`
refer to them.

## Scale

- **200k page loads** and **100k block edits** per second at peak. Notion
  does not publish request rates; these are assumptions for the exercise.

## Constraints

- Blocks stay in PostgreSQL, and every query goes through PgBouncer: no
  connection from the API servers to the database.
- An edit is written to Postgres before the API answers.
- p99 of both use cases under **70 ms**.
- Both available **99.95%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$30,000 / month**, PgBouncer included.

## What is given

`problem.proschi` declares `web`, the API servers (the client of this
problem), and `pgbouncer`, ten PgBouncer instances. Add the Postgres fleet
as one node, choose how many shards with `capacity { db shards N }`, and
write the two use cases.

## What this model leaves out

- The partition key itself is not something the simulation reads. What it
  sees is its effect: a query that needs every shard is written as a
  fan-out (`x32`) and loads every shard.
- Load is spread evenly over the shards. A workspace id spreads well because
  there are millions of workspaces; one giant workspace could still make
  one shard hotter than the rest.
- Logical shards (schemas) are labels here: the simulation counts physical
  databases. Connection limits, which PgBouncer exists for, are not
  simulated; the flow test asks for it instead.
- The migration (double writes, backfill, verification, the switch-over) is
  not part of the problem.

## Based on

- Garrett Fidalgo, [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion),
  Notion blog, 2021: the monolith's stalled VACUUM and looming
  transaction id wraparound, application-level sharding of the block table
  and everything related to it by workspace id, 480 logical shards (one
  Postgres schema each) on 32 physical databases, and the migration by
  double writes through an audit log, backfill, verification and dark reads.
- Arka Ganguli, Tanner Johnson, Ben Kraft and Nathan Northcutt, [The Great Re-shard: adding Postgres capacity (again) with zero downtime](https://www.notion.com/blog/the-great-re-shard),
  Notion blog, 2023: shards above 90% CPU at peak by the end of 2022, the
  move from 32 to 96 databases (from 15 to 5 logical shards each), and
  PgBouncer between the web servers and Postgres, split into four clusters
  of 24 databases.
