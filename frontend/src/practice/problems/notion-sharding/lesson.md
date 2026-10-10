# Notion Sharding: when one Postgres primary is not enough

```tldr
At 100k writes a second against 5k per primary, this is a **write problem**: **replicas add no write capacity**, so you need **shards**. Partition by **workspace ID** so each request touches one shard, give each shard **one standby**, route every query through **PgBouncer**, and use **logical shards** so growing the fleet later means moving schemas, not rehashing rows.
```

## What you'll learn

- Why read replicas scale reads but never writes, and why sharding is the only way to add write capacity to a relational database.
- How to choose a partition key so that a request touches one shard, and what happens when you choose badly.
- How logical shards make future re-sharding cheap.
- How to size a sharded fleet from a write rate, a per-primary capacity and a latency target.

## The problem, explained

Notion stores everything as **blocks**: a page is a block, and so is every paragraph, heading and to-do in it. Until 2021 all blocks lived in one PostgreSQL database. Past 20 billion rows, `VACUUM` (Postgres's background cleanup of dead row versions) could not keep up, and **transaction ID wraparound**, where Postgres stops accepting writes to protect the data, was near. A bigger machine would only buy months, so Notion split the data across many databases.

Two use cases:

- **Load page**: a user opens a page, and the API reads its blocks.
- **Edit block**: a user types into a block, and the change is written to Postgres before the API answers.

The scale is an assumption for the exercise (Notion does not publish request rates): 200k page loads and 100k block edits per second at peak. Both use cases need a p99 under 70 ms and 99.95% availability, and losing any single machine must not break a latency limit. The budget is $30,000 a month, PgBouncer included.

**What is given.** `given.proschi` declares `web`, the API servers that decide which shard a query goes to, as the client, and `pgbouncer`, ten PgBouncer instances. PgBouncer is a connection pooler: Postgres runs one process per connection, so thousands of API processes connecting directly would exhaust it; the pooler shares a few real connections among them. You add the Postgres fleet as one node, choose its shard count with `capacity { db shards N }` (the only capacity line a solver may write), and write both use cases.

**What the tests check**: both use cases start at `web` and go through `pgbouncer` before Postgres; there is no path from `web` to any database; page loads read Postgres and edits write Postgres before responding. The requirements add p99, availability, durability, failure survival and cost.

```deepdive What the model leaves out
The statement says so too. The simulation cannot see the partition key itself, only its effect: a query that needs every shard is written as a fan-out (`x32`) and loads every shard. Load is spread evenly over the shards, connection limits are not simulated, and the migration is out of scope.
```

## Back-of-the-envelope

The simulation's numbers for a PostgreSQL replica are 20k reads and 5k writes per second. The crucial detail: Postgres is **single-primary**. Every replica serves reads, but every write goes to the one primary of its shard.

```numbers
100k rps | writes (edits)
5k rps | write capacity of one primary
20 | primaries needed at 100%
60% | PgBouncer load
2,000% | monolith write utilisation
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Reads (page loads) | given | 200k rps |
| Writes (edits) | given | 100k rps |
| Read:write ratio | 200k : 100k | 2 : 1 |
| Write capacity of one primary | simulation default | 5k rps |
| Primaries needed at 100% | 100k ÷ 5k | 20 |
| Read capacity of a shard with a primary and a replica | 2 × 20k | 40k rps |
| PgBouncer load | 300k ÷ (10 × 50k) | 60% |
| Monolith with 4 replicas: write utilisation | 100k ÷ 5k | 2,000% |

This is a write problem: 100k writes need at least 20 primaries just to avoid saturation, and replicas add zero write capacity.

**How many shards, then?** Not twenty at 100%. The simulation queues each shard's writes on its one primary (one server, so the classic `1 ÷ (1 − ρ)` slowdown): at 50% busy a hop takes twice its base latency, at 70% over three times. With a 70 ms p99 limit and an idle hop's p99 about 2.8 times its mean, the primaries must stay well below 70% busy. Write utilisation per shard is `100k ÷ (5k × shards)`: 20 shards give 100%, 25 give 80%. Add shards until the p99 holds, then check the budget.

**Cost.** Each replica of each shard costs $400 a month, PgBouncer $100 per instance. So `shards × replicas × $400 + $1,000 ≤ $30,000`, which caps `shards × replicas` at 72. Two replicas per shard (a primary and a standby for failover) fits a shard count in the 30s; three cut the affordable count to 24, too few for the write rate.

**Availability and failure.** With a replica, a failed Postgres primary is replaced by promotion; the model charges writes 10% of the primary's downtime for the failover, which still clears 99.95%. `survive any node failure` takes one instance out of one shard: writes keep a primary, reads lose a replica. At 200k reads spread over dozens of shards, one shard's reads fit comfortably on one remaining replica.

```deepdive Storage, for scale
20 billion rows at, say, 1 KB each (an assumption) is about 20 TB, a lot for one Postgres host to vacuum. Split over a few dozen databases it is well under a terabyte each.
```

```quiz
shards-for-write-rate
```

## Concepts

### Replicas scale reads, shards scale writes

**Replication** copies the same data to several machines. In a single-primary database such as Postgres or MySQL, replicas apply the primary's changes, serve reads and stand by for failover. They do nothing for writes: every replica applies every write, so the primary stays the bottleneck, and replicas add write work.

**Sharding** (horizontal partitioning) splits the rows across independent databases, each with its own primary. Ten shards means ten primaries and ten times the write capacity, as long as writes spread evenly. The price is complexity: the application must know where each row lives, cross-shard queries and transactions become hard, and rebalancing is a project.

Use replicas first when reads are the problem: they are cheap and invisible to the application. Shard only when writes, data size or maintenance (like `VACUUM`) outgrow one primary. Do not shard to fix a slow query or a missing index.

```callout takeaway Count primaries, not machines
Replicas scale reads. Only more **primaries** (shards) scale writes.
```

```proschi
title "Sharded relational store"

app "App"      [Actor]
db  "Store"    [PostgreSQL] x2

capacity {
  db shards 4
}

app -> db : SQL

usecase "Save" {
  app -> db  : UPDATE item SET name WHERE tenant_id = $1
  db --> app : UPDATE 1
}
```

### Choosing a partition key

The **partition key** is the column that decides which shard a row lives on, usually through a hash. A good key has two properties:

1. **Locality**: the queries you run most need rows from only one shard. Anything else turns one query into many.
2. **Spread**: the key has many distinct values with similar load, so no shard is much hotter than the rest.

For Notion, the workspace ID wins on both. Every block, comment and discussion belongs to exactly one workspace, and nearly every request (load a page, save an edit) concerns one, so it touches one shard.

| Key | Spread | Locality |
|---|---|---|
| **Workspace ID** | Good: millions of workspaces | Good: a request touches one shard |
| **Block ID** | Perfect | Terrible: a page's 120 blocks hash to every shard, so loading one page asks all of them |
| **User ID** | — | Poor: a workspace is shared by many users, so a team's pages scatter across shards by whoever created them |

```callout pitfall Scatter-gather
A query that asks every shard costs one request per shard and **waits for the slowest**. That is what a block-ID key does to every page load.
```

When not to shard by tenant: when one tenant can outgrow a shard (a single huge customer becomes a **hot shard**), or when the core queries cross tenants (a global feed). Then you need a finer key, a dedicated shard for the giant, or a different data model.

```quiz
workspace-partition-key
```

### Logical shards and the routing layer

Re-sharding, moving rows between databases while serving traffic, is the expensive part. Notion's trick was to create many more **logical shards** than physical databases: 480 Postgres schemas, 15 per database. The application maps workspace → logical shard (fixed forever) and logical shard → database (a small table). Growing the fleet means moving whole schemas to new machines; no row is ever re-hashed.

480 was chosen because it divides evenly into many fleet sizes, and Notion later did exactly that, going from 32 to 96 databases.

**Routing** happens in the application: the API computes the shard from the workspace ID and sends the query to the matching database through PgBouncer. Other designs put routing in a separate layer, such as Vitess for MySQL or the Citus coordinator for Postgres. That layer hides sharding from the application, but it is another moving part on the hot path.

```quiz
logical-shards
```

## Designing it step by step

### 1. Scope the problem

Ask: the read and write rate? (200k and 100k per second.) What do the main queries filter on? (Workspace and parent block.) Must the data stay in Postgres? (Yes.) A connection limit? (Yes, hence PgBouncer.) Point out that 2:1 read:write is unusually write-heavy: that alone says replicas will not be enough.

### 2. High-level design

The flow is short: web → PgBouncer → Postgres, for both use cases. The design question is the shape of the Postgres node. Walk through the alternatives in order:

| Option | Why it fails or wins |
|---|---|
| A bigger monolith | The write rate is twenty times what one primary takes |
| A monolith with read replicas | Same primary, same problem |
| A few shards with many replicas | More primaries, but still not enough for 100k writes, and the replicas you pay for sit mostly idle |
| **Many shards with one standby each** | Write capacity scales with the shard count, and the standby covers failover: this wins |

Then the key: partition by workspace ID, so each request names its shard and touches one.

### 3. Deep dive

**The shard count.** Pick a count that keeps write utilisation per primary under about two-thirds, check the p99 in the analysis, then check that two replicas per shard fit the budget. To reason like Notion, prefer a count that divides a larger number of logical shards evenly.

**Reads.** With two replicas per shard, read capacity is far above 200k rps; writes are the constraint. Note that the simulation reports the busier of the two sides for a single-primary store.

**PgBouncer.** Ten instances at 50k rps each carry 300k requests at 60%. It is given; route every query through it. The test "Queries go through PgBouncer" enforces that, including its line `no path from web to any database`.

**Failure.** Losing a primary promotes the standby; losing a standby costs read capacity on one shard. Run the analysis and confirm no latency limit breaks with an instance missing.

### 4. Wrap-up

Summarise: shard by workspace ID across enough primaries to keep writes around two-thirds busy, one standby per shard, routing in the application, pooling in PgBouncer, logical shards for cheap growth. Next steps worth naming: the migration (double writes, backfill, verification, then switching reads), monitoring for hot workspaces, and a plan for the day shards run hot again (Notion's 2023 re-shard).

## Common mistakes

**One big database** (`wrong/one-big-database.proschi`). Keep the monolith and add replicas: four replicas, one primary, and all 100k edits still land on that primary, which takes 5k. This is the "just buy a bigger box" plan, and Notion's story is how it ends: maintenance falls behind and wraparound looms. It fails the p99 of both use cases, because the saturated database is on both paths (and `survive any node failure` too).

**Replicas instead of shards** (`wrong/replicas-instead-of-shards.proschi`). Four shards with eight replicas each: lots of read capacity, only four primaries. 100k writes on 20k of write capacity saturate the primaries. It fails the p99 of Edit block, and of Load page too, because pages are read from the same overloaded shards. Count primaries, not machines.

**Shard by block ID** (`wrong/shard-by-block-id.proschi`). Writes spread perfectly, but a page's blocks live on every shard, so a page load becomes an `x32` fan-out: 200k page loads turn into 6.4 million shard reads a second. It fails the p99 of Load page, and of Edit block too, because edits wait behind those reads on the same shards. In production this is the classic scatter-gather trap: every page load waits for the slowest shard, and one slow shard slows every page.

**Direct connections** (`wrong/direct-connections.proschi`). The API servers connect to Postgres directly: with hundreds of API processes and dozens of databases, thousands of connections, each a Postgres backend process with its own memory. It fails "Queries go through PgBouncer".

**Three replicas per shard.** Tempting for safety, but at a shard count that handles the writes, it breaks the $30,000 budget. One standby per shard is enough to survive a single failure.

## In the interview

Start with the arithmetic that rules out the easy answers, then spend your time on the partition key, which is what the interviewer most wants to hear about.

```callout interview Rule out replicas in one sentence
"100k writes a second against 5k per primary means at least 20 primaries before any headroom. Replicas do not add primaries, so this is a sharding problem."
```

Expected follow-ups:

- **What if one workspace becomes huge?** It becomes a hot shard. Move its logical shard to a dedicated database, or split that tenant further by a secondary key (such as page ID) at the cost of cross-shard queries for it alone.
- **How do you migrate without downtime?** Double-write to old and new stores (Notion used an audit log and catch-up), backfill history, verify by comparing reads, then switch reads, then stop writing the old store.
- **How do you run a query across all workspaces?** Not on the OLTP shards: stream changes into an analytics store and query there.
- **Why not a distributed SQL or NoSQL database?** Possible, but that migrates the whole data model and its tooling; application-level sharding kept Postgres, its tools and the team's expertise.
- **How do you add capacity later?** Move logical shards to new databases; because 480 divides evenly into many sizes, each new database receives whole schemas.

## Further reading

- [Herding elephants: Lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion), Notion blog, 2021: the original story, the choice of workspace ID, 480 logical shards on 32 databases, and the migration.
- [The Great Re-shard: adding Postgres capacity (again) with zero downtime](https://www.notion.com/blog/the-great-re-shard), Notion blog, 2023: going from 32 to 96 databases by moving logical shards, and how PgBouncer was split.
- [System Design Primer: Sharding](https://github.com/donnemartin/system-design-primer#sharding): what sharding buys and its disadvantages, including lopsided shards and cross-shard joins.
- [System Design Primer: Master-slave replication](https://github.com/donnemartin/system-design-primer#master-slave-replication): why replicas serve reads while one primary takes the writes.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "Relational Databases" list links the Notion post alongside similar sharding stories from other companies.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): "Scale From Zero To Millions Of Users" for replication and sharding, and "Design Consistent Hashing" for spreading keys over shards.
