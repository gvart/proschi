# Read Replicas: scaling reads without touching the writes

```tldr
At 60k reads and 3k writes a second, the **writes fit on one primary** and only **read capacity** is missing. Add a **pool of read replicas** behind the proxy, size it so it survives **losing one replica**, and keep **writes and reads that must see the latest write** on the primary, because replicas **lag**.
```

## What you'll learn

- Why read replicas are the first tool for a read-heavy relational database, and why they add nothing for writes.
- How to size a replica pool from a read rate, a per-replica capacity and the rule that one replica may fail.
- What replication lag is, which reads can live with it, and why read-your-writes reads go to the primary.
- What monotonic reads are and how Shopify gets them by hashing related reads to one replica.
- When sharding is the answer instead, and why it is the wrong one here.

## The problem, explained

Shopify runs on MySQL. For a long time its replicas existed for redundancy: if a primary failed, a replica took over. Then Shopify started reading from them, to make read-heavy applications faster and to take load off the primaries, which are needed for writes and for reads that cannot be out of date. Applications reach MySQL through **ProxySQL**, a proxy that groups interchangeable servers and picks one for each query, so the application never needs to know how many replicas there are or where they live.

Three use cases:

- **Read catalog**: a storefront page reads a shop's products. If a merchant changed a price two seconds ago, showing the old price for a moment is acceptable.
- **Place order**: checkout writes the order to MySQL before answering.
- **Check order**: the order status page, opened right after checkout, reads the order just placed. It must find it.

The rates are assumptions for the exercise (Shopify does not publish them): 60k catalog reads, 3k orders and 2k order checks a second at peak. The limits are a p99 under 40 ms for catalog reads and under 80 ms for the other two, 99.95% availability, surviving the loss of any one machine, and at most $3,400 a month.

**What is given.** `app` is the application (the client), `proxy` is three ProxySQL instances, and `primary` is the MySQL primary with a standby ready to take over. You add the replica pool as one MySQL node, connect it, and write the three use cases.

**What the tests check**: every use case starts at `app` and goes through `proxy` before any database, and there is no path from `app` to a database; catalog reads reach a database in every scenario but never the primary; orders are written to the primary before the answer, and order checks always read the primary.

```deepdive What the model leaves out
The simulation does not model replication lag: its replicas are always current. That is why the rule "fresh reads go to the primary" is a flow test rather than a number. It also does not model which replica answers a given query, so monotonic reads are taught here but not graded.
```

## Back-of-the-envelope

The simulation's figures for a MySQL server are 20k reads and 5k writes a second, $400 a month. MySQL is **single-primary**: every server in a replica set can serve reads, but writes go to the one primary.

```numbers
60k rps | catalog reads
3k rps | writes, 60% of one primary
155% | primary load if it serves the catalog
5 | replicas, one of them spare
$3,100 | monthly cost
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Reads | 60k catalog + 2k order checks | 62k rps |
| Writes | given | 3k rps |
| Read:write ratio | 62k : 3k | about 20 : 1 |
| Primary write load | 3k ÷ 5k | 60% |
| Primary and standby, read capacity | 2 × 20k | 40k rps |
| Catalog on the primary | 62k ÷ 40k | 155%: saturated |
| Replicas at 100% | 60k ÷ 20k | 3 |
| Replicas at 75% | 60k ÷ 15k | 4 |
| Replicas at 75% with one down | 4 + 1 | 5 |
| Cost | 5 × $400 + 2 × $400 + 3 × $100 | $3,100 |

The ratio says where the work is: the writes already fit on one primary, so this is a read problem. A primary and its standby serve about 40k reads a second between them; the catalog needs half as much again. Moving the catalog to replicas leaves the primary with 3k writes and 2k order checks, at 60% (the write side, which the model counts for a single-primary store).

**Why 75%?** A busy server queues. At 75% each read waits a little, and the p99 stays comfortably under 40 ms. At 100% the queue grows without limit and every latency limit breaks. So the pool must stay below about 75% **on its worst day**, which is the day a replica is down.

**Budget.** The proxies and the primary cost $1,100, which leaves $2,300 for replicas: five fit, six ($2,400) do not.

```quiz
read-replicas-pool-size
read-write-ratio-first
```

## Concepts

### Replicas scale reads, not writes

A read replica holds a full copy of the database and applies every change the primary makes, in the same order. Any replica can therefore answer any read, and adding one adds a whole server's worth of read capacity. No change to the schema or the queries is needed: the data model stays one database.

The cost is that every replica also applies **every write**. Replicas cannot share the write load: three replicas each do all of the primary's writes. So replicas are the right tool exactly when reads dominate and the writes fit on one primary, which is the common case for storefronts, catalogs, feeds and dashboards.

```callout takeaway
Replicas add read capacity at the price of one more copy to keep in step. They add **no** write capacity.
```

### Sizing the replica pool

Size the pool in three steps. First, the load: 60k catalog reads a second. Second, the target utilisation: about 75%, so each replica carries 15k. Third, the failure: one replica may be down at any time (a crash, a restart, a rebuild after a disk failure, a planned upgrade), so the pool needs one more than the load requires. That is **N + 1**: four replicas to carry the load, one spare.

The spare is not idle. All five share the load at 60% each, and when one fails the other four rise to 75%. With only four, a failure leaves three at 100%, and the pool saturates during the very event it was supposed to absorb.

| Replicas | Normal load | One down |
|---|---|---|
| 3 | 100% | 150% |
| 4 | 75% | 100% |
| **5** | **60%** | **75%** |
| 6 | 50% | 60% |

Six would also work, at a higher cost; the budget here rules it out.

### Replication lag and which reads can tolerate it

MySQL replication is **asynchronous**: the primary commits, answers the client, and ships the change to the replicas afterwards. A replica is therefore always slightly behind: usually by a fraction of a second, but, as Shopify's post notes, sometimes by seconds or even minutes.

So the question for every read is: what happens if it sees data a few seconds old?

- **Read catalog**: a price shown at its old value for a moment. Harmless; send it to the replicas.
- **Check order**: a shopper who has just paid is told their order does not exist. Not acceptable; this is a **read-your-writes** read and goes to the primary.

The primary has room for such reads because the replicas took the bulk away. That is the whole point: Shopify's post describes the primaries as needed for writes and time-sensitive reads, and the replicas as a way to keep load off them.

```callout pitfall
"Read from replicas" is never a blanket rule. Classify the reads: the ones that must see the latest write stay on the primary.
```

```deepdive Other ways to get read-your-writes
Reading from the primary is the simplest fix. Others: route a user's reads to the primary only for a short window after they write; or remember the position of the user's last write and read from a replica only once it has applied that position. MySQL's global transaction ids (GTIDs) make the second possible: Shopify started building it, but decided its use cases did not need that strength, because it requires each replica to report its position to the proxy.
```

```quiz
read-your-writes
sync-vs-async-replication
```

### Monotonic reads: one replica per series of reads

Lag causes a subtler problem too. Suppose a background job runs several related queries, and the proxy sends each to a random replica. One replica is 1 second behind, another 10 seconds. The job may see a row in its first query that is missing from a related table in its second, or see time go backwards between two reads. If the job then writes based on what it read, the inconsistency spreads.

The guarantee that prevents this is **monotonic reads**: successive reads never move backwards in time, even if they are not the latest. Shopify considered stronger options (waiting until every replica caught up, which removes the benefit of replicas; and GTID-based causal consistency) and chose monotonic reads as enough for its uses.

The mechanism is simple. An application that wants it tags its related queries with a shared id, a UUID for the job, in a SQL comment (`consistent_read_id`). ProxySQL hashes the id and takes it modulo the number of servers: the same id always lands on the same replica, so the job reads from one timeline. The application still knows nothing about the topology.

Two lessons came out of running it:

- **When the chosen replica is down**, picking among only the live servers changes the modulus and moves almost every id to another replica. Shopify indexes into the full configured list first and re-picks only if that server is down, so a failure moves only the ids that were on it.
- **Nothing may override the pick.** An extra rebalancing pass in ProxySQL occasionally moved requests to a less loaded server, breaking consistency in a small share of cases. Shopify disabled it for tagged queries.

The weakness that remains: if a replica goes down between two reads of a series, that series switches replica and may see an inconsistency. Shopify accepts that for applications that tolerate the occasional failure.

```quiz
monotonic-reads
read-replicas-stable-pick
```

### A proxy in front of the database

The app could connect to each replica itself, but then every application server must know the list of replicas, notice when one fails, and be redeployed when one is added. A proxy keeps that in one place: it groups interchangeable servers, picks one for each query, and stops sending to a server that is down. Adding a replica becomes a proxy configuration change. It is also where routing rules live, such as "writes to the primary" and "hash this id to one replica".

### Replicas or shards?

Sharding splits the data across several primaries, each with its own copy of part of the data. It is the only way to add **write** capacity to a single-primary database, and it is expensive in complexity: every query must name its shard, and queries across shards become fan-outs.

Here the writes need 60% of one primary. Four shards would add three primaries nobody needs, each with its own standby for failover, and the reads still would not have a home that keeps them off the primaries. Shard when the write rate outgrows one primary (the Notion problem); until then, replicas.

```quiz
replicas-do-not-scale-writes
shards-for-write-rate
```

## Designing it step by step

### 1. Scope the problem

Ask for the read and write rates (60k reads, 3k writes, 2k order checks a second). Ask which reads must see the latest data: the order status page must; the catalog may be a few seconds old. Ask whether a cache is in scope (not here; the catalog is read from MySQL).

### 2. High-level design

The flow for every use case is app → proxy → MySQL. Only the last hop differs:

| Use case | Goes to | Why |
|---|---|---|
| Read catalog | replicas | Bulk of the load, tolerates lag |
| Place order | primary | Writes go to the one primary |
| Check order | primary | Must see the order just written |

Add the replica pool as one MySQL node and connect the primary to it (replication), the proxy to both.

### 3. Deep dive

**Pool size.** Five replicas: four carry the load at 75%, one is the spare. Confirm in the analysis that losing one keeps the catalog's p99 under 40 ms.

**The primary.** 3k writes at 60%, plus 2k order checks; it is given with a standby, so a primary failure promotes the standby.

**Consistency.** State which reads are routed where and why. If the interviewer asks about related reads seeing different replicas, explain monotonic reads by hashing.

### 4. Wrap-up

Summarise: replicas for the reads that tolerate lag, the primary for writes and fresh reads, N + 1 sizing, the proxy hiding the topology. Name the next steps: monitoring replica lag and taking a far-behind replica out of the pool, a cache for the hottest catalog pages, and sharding once writes approach the primary's limit.

## Common mistakes

**Every read on the primary** (`wrong/all-reads-on-primary.proschi`). No replicas: the primary and its standby get 62k reads a second against about 40k of capacity, so the database saturates. It fails the catalog's p99 and "Catalog reads go to the replicas", and, because the same saturated server is on every path, the other latency limits and the failure test too.

**No room for a failure** (`wrong/no-room-for-a-failure.proschi`). Four replicas run at 75% and pass every latency limit, until one is lost and three must carry 60k reads at 100%. It fails `survive any node failure`. Size for the worst day, not the average one.

**Reading a fresh write from a replica** (`wrong/fresh-read-from-a-replica.proschi`). All reads go to the replicas, including the order status page. The numbers pass, which is what makes the mistake dangerous: in production a lagging replica tells a paying customer their order is missing. It fails "Writes and time-sensitive reads go to the primary".

**Sharding for reads** (`wrong/shard-for-reads.proschi`). Four shards of the primary, no replicas. There is enough read capacity, but it costs eight servers, breaks the budget, and puts the catalog back on the primaries. It fails "Catalog reads go to the replicas" and the cost limit (and the failure test, as one shard is left on one server).

## In the interview

Open with the ratio, then the classification of reads: those two sentences carry most of the design.

```callout interview Say the routing rule out loud
"Writes and anything that must see the latest write go to the primary. Everything that can be a few seconds old goes to the replica pool, sized N + 1."
```

Expected follow-ups:

- **What if a replica falls far behind?** Monitor lag per replica and have the proxy stop sending reads to one beyond a threshold; Shopify mentions using lag measurements as a tunable factor as future work.
- **A job reads several related tables and sees inconsistent data. Why, and how do you fix it?** Its queries hit replicas with different lag. Route the series to one replica by hashing a shared id: monotonic reads.
- **How do you guarantee a user sees their own write?** Read from the primary, at least for a window after the write; or wait until a replica has applied the write's GTID.
- **The primary fails. What happens?** The standby is promoted; replicas then follow the new primary. Asynchronous replication can lose the last few transactions in that switch unless replication is semi-synchronous.
- **When would you shard?** When writes approach what one primary takes, or the data no longer fits one server.

## Further reading

- [Read consistency with database replicas](https://shopify.engineering/read-consistency-database-replicas), Thomas Saunders, Shopify Engineering blog, 2021: the post this problem is based on, from ProxySQL hostgroups to the hashing fix.
- [MySQL Reference Manual: Replication](https://dev.mysql.com/doc/refman/8.0/en/replication.html): asynchronous and semi-synchronous replication, and GTIDs.
- [ProxySQL documentation](https://proxysql.com/documentation/): hostgroups, query routing and read/write splitting.
- [System Design Primer: Master-slave replication](https://github.com/donnemartin/system-design-primer#master-slave-replication): replicas for reads, and their disadvantages.
- *Designing Data-Intensive Applications* (Martin Kleppmann), chapter 5, "Replication": "Problems with Replication Lag" covers read-your-writes and monotonic reads.
