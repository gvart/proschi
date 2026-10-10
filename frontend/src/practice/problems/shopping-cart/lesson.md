```tldr
"Never reject an add" makes the cart **available over consistent (AP)**. A single-primary database caps writes at **99.995%**, below five nines, so carts go to a **leaderless, replicated store** where any replica takes a write. Concurrent writes leave versions; reads **merge them by union and write the result back**, so no add is lost.
```

## What you'll learn

- The **availability vs consistency** trade-off, and how a business requirement ("never reject an add") picks a side for you.
- Why a **single-primary** database can't promise five nines for writes, and how **leaderless replication** can.
- What **quorums** (N, R, W) are and how they tune the trade-off.
- How **versioning and merge-on-read** keep every add when concurrent writes conflict, and what that merge costs.
- How to count **nines**: what 99.999% means in minutes, and how replicas get you there.

## The problem, explained

This problem is modelled on a real system. In 2007 Amazon published the paper on **Dynamo**, the key-value store built because some services, the shopping cart first, must stay writable whatever is failing. If "Add to cart" fails, the customer may leave and the sale is gone: a briefly out-of-date cart is an annoyance, a rejected add is lost revenue.

Two use cases:

- **Add to cart**: a shopper adds an item and gets `200`, the add durable before that answer.
- **View cart**: a shopper opens their cart and gets `200`, with two scenarios:
  - `"One version"`: the store holds a single version of the cart (the usual case).
  - `"Divergent versions"`: two writes raced, or a node was cut off, so the store returns several versions. The service merges them so no add is lost, and writes the merged cart back before answering.

The non-functional requirements:

- **Scale**: 500 adds and 1k cart views per second at peak. In Amazon's measurement, 99.94% of reads saw exactly one version.
- **Latency**: the **99.9th percentile** (p99.9) of both use cases under 300 ms, the Dynamo paper's example SLA (service level agreement). Amazon measured the tail, not the average, because the slowest requests often belong to the most valuable customers (with the longest histories).
- **Availability**: Add to cart works **99.999%** of the time ("five nines").
- **Durability**: an add survives once the shopper hears `200`.
- **Consistency**: carts live in an eventually consistent store; a strongly consistent one must refuse writes it cannot coordinate.
- **Fault tolerance**: losing any single machine doesn't take the cart down.
- **Budget**: $3,000 a month.

`given.proschi` declares the `shopper` and the traffic mix (`"One version"` 99.94%, `"Divergent versions"` 0.06%), the requirements and two tests:

1. **Adds go to an eventually consistent store that is always writable**: Add to cart writes a database before answering, never calls a *strong* store, and answers `200`.
2. **Divergent versions are merged and written back**: View cart has a `"Divergent versions"` scenario that writes to a database before answering.

## Back-of-the-envelope

```numbers
≈ 26 s | of downtime a month at five nines
≈ 5.3 min | of downtime a year
99.995% | best write availability of one primary
≈ 500 rps | writes to the store
≈ 0.6 / s | merges
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Write share | 500 ÷ (500 + 1,000) | one request in three is a write |
| Merges per second | 1,000 × 0.06% | ≈ 0.6 |
| Writes to the store | 500 adds + 0.6 merges | ≈ 500 rps |
| Reads from the store | 1,000 views | 1,000 rps |
| Five nines, per year | 525,600 min × 0.001% | ≈ 5.3 minutes of downtime |
| Five nines, per month | 43,200 min × 0.001% | ≈ 26 seconds of downtime |
| Cart data (assumption) | 50 M carts × 2 KB | ≈ 100 GB |

The cart count and size are assumptions to show the method; far more still fits one store with replicas.

```callout takeaway
**Storage and throughput are not the hard part here. Availability is.** Twenty-six seconds of downtime a month is less than one database failover takes.
```

Availability per component, with the simulation's default numbers:

| Component | Up per replica | With 2 replicas | With 3 replicas |
|---|---|---|---|
| Load balancer | 99.99% | 99.999999% | — |
| Service (`[REST API]`) | 99.5% | 99.9975% | 99.99999% |
| Leaderless NoSQL (`[DynamoDB]`) | 99.99% | 99.999999% | ≈ 100% |
| Relational (`[PostgreSQL]`), **writes** | 99.95% | 99.995% | 99.995% |

The last row is the key insight. In the model, as in real life, a relational database has **one primary per shard** taking every write. Replicas serve reads and can be promoted when the primary dies, but writes wait out the promotion. The simulation keeps 10% of the primary's downtime for that, so writes reach 99.995% however many replicas you add: **below five nines, by design.**

A leaderless store takes a write on any replica, so each added replica cuts its unavailability by another factor. Path availability is the product of its nodes: with enough replicas of each, Add to cart comes out far above 99.999%.

Load and latency:

- The store sees about 1,000 reads and 500 writes per second against 20,000 of each per replica: nearly idle.
- The service sees 1,500 rps against 2,000 per replica. One replica would already be 75% busy, and availability needs more than one anyway.
- Latency: a load balancer (~2 ms), a service (~10 ms) and a store (~5 ms) stay well under 300 ms even at p99.9, where an idle hop is about 4× its mean. The limit catches saturated designs; it isn't asking you to optimise.
- Cost: about $500 per leaderless-store replica per month, $100 per service, $50 per load balancer. Multiply out before you run.

## Concepts

### Availability vs consistency

**What it is.** When the network splits replicas apart (a *partition*), a replicated store must choose: refuse requests it can't coordinate (stay *consistent*: every read sees the latest write), or accept them and reconcile later (stay *available*). That's the CAP theorem in one sentence. Even without partitions, coordinating every write costs latency, and a single coordinator, such as a primary, is one place where writes stop.

**Why it matters here.** The business has chosen: an add is never rejected. That makes the cart an **AP** system (available under partition), with *eventual* consistency: replicas converge once they can talk again.

**Trade-offs.** Readers may briefly see an older cart, and two versions may coexist; the application must handle that.

**When not to choose availability.** Money, inventory counts, unique usernames: anything where two conflicting "yes" answers can't be merged afterwards. They come in this roadmap's consistency stage.

```proschi
title "Strong vs eventual"

app    "App"          [REST API]   x2
ledger "Ledger"       [PostgreSQL] x2 "Strong: one primary orders every write"
prefs  "Preferences"  [Cassandra]  x3 "Eventual: any replica takes a write"

app -> ledger : SQL
app -> prefs  : CQL
```

```quiz
never-reject-an-add
```

### Leaderless replication and quorums

**What it is.** In a leaderless store (Dynamo, Cassandra, Riak), every key is copied to **N** replicas. A write goes to all N and succeeds once **W** acknowledge; a read waits for **R** answers. With N=3, W=2, R=2 (common, per the Dynamo paper), any read overlaps any successful write on at least one replica, because R + W > N.

**Why it's always writable.** No replica is special, so losing one doesn't stop writes. Dynamo goes further with a *sloppy quorum*: if some of a key's usual replicas are unreachable, the write goes to the next healthy nodes, which hold it as a *hint* and hand it back when the owners return (*hinted handoff*). The add is accepted and durable even mid-failure.

**Trade-offs.** Lower W means faster, more available writes but a greater chance of stale reads. Concurrent writes to different replicas create **conflicts** that someone has to resolve. Operations get harder: background repair (Dynamo compares replicas with Merkle trees) and membership gossip.

**When not to use it.** When you need transactions across keys, unique constraints or strict ordering: a relational database with a primary is simpler and gives you those.

```proschi
title "Leaderless store"

client "Client"     [Actor]
svc    "Service"    [REST API]  x3
kv     "Replicated" [DynamoDB]  x3 "N=3: any replica takes a write"

client -> svc
svc    -> kv : read / write

usecase "Save" {
  client -> svc   : PUT /things/7
  svc    -> kv    : PutItem thing 7
  kv    --> svc   : ok from W replicas
  svc   --> client : 200
}
```

```quiz
leaderless-replication
sloppy-quorum
```

### Versioning and merge on read

**What it is.** If two writes to the same cart land on different replicas without seeing each other, neither is "newer": they are *concurrent*. Dynamo tags every version with a **vector clock**, a small list of (node, counter) pairs. Comparing two clocks tells whether one version descends from the other (keep the descendant) or they're concurrent (keep both, and return all of them to the application on read).

**Why merge in the application.** Only the application knows what a cart *means*. The **union** of the items in both versions keeps every add. The merged cart is written back with a clock descending from both, resolving the conflict for every later reader.

**Trade-offs.** The union can bring back an item the shopper deleted in one of the versions. Amazon judged that acceptable: a resurrected item is a nuisance, a lost add is a lost sale.

```callout pitfall Last write wins loses adds
**Last write wins** (keep the version with the latest timestamp) is simple, and silently drops one of two concurrent adds.
```

**When not to use it.** When there's no meaningful merge (two people booking the last seat), or conflicts are rare and harmless enough for last-write-wins (a "last seen" timestamp).

````deepdive Merge on read in Proschi
```proschi
title "Merge on read"

client "Client"   [Actor]
svc    "Service"  [REST API] x2
kv     "Store"    [DynamoDB] x3

client -> svc
svc    -> kv : read / write

usecase "Read doc" {
  client -> svc : GET /docs/7
  svc    -> kv  : GetItem doc 7, every version
  alt "Single" {
    kv --> svc : one version
  } alt "Conflict" {
    kv  --> svc : two versions
    svc  -> kv  : PutItem merged doc 7
    kv  --> svc : ok
  }
  svc --> client : 200
}
```
````

```deepdive Dynamo is not DynamoDB
The 2007 Dynamo paper and today's Amazon DynamoDB service are not the same system. DynamoDB doesn't hand you vector clocks or sibling versions; you'd use conditional writes instead. In Proschi, `[DynamoDB]` simply stands for a leaderless, eventually consistent store, which is the property this problem is about.
```

```quiz
version-vectors
last-write-wins-loss
```

## Designing it step by step

### Step 1: Scope

Ask what failure means to the business: "If the cart can't take an add for 30 seconds, what happens?" Lost sales justifies everything else. Confirm the numbers: 500 adds, 1k views, five nines on adds, p99.9 under 300 ms. Checkout, prices and inventory are out of scope; checkout is where you *do* want strong consistency, in a different service.

### Step 2: High-level design

Shopper → load balancer → stateless cart service → store, which holds all state. Draw both use cases; for View cart write both scenarios with `alt` and `when` conditions that explain them.

The first real decision is the store:

| Option | Upside | Cost |
|---|---|---|
| **Relational with replicas** | Familiar, transactional | Every add needs the one primary, and a failover blocks adds: writes cap out around 99.995% |
| **An in-memory cache** | Fast and always writable | A node restarts and the adds are gone |
| **A leaderless, eventually consistent store** | Any replica takes a write; durability comes from writing to several disks | Conflict handling |

The third fits the requirement, and the tests check that adds never touch a strong store.

### Step 3: Deep dive

**The add.** The service writes the cart with its version information and answers `200` only after the store acknowledges. No queues, no write-behind: the add is durable before the answer.

**The view.** Read every version. `"One version"` needs nothing more. In `"Divergent versions"`, merge (union of items), **write the merged cart back**, then answer; otherwise every future read sees the conflict again and versions pile up.

**Replication.** How many replicas of the store does five nines take? Use the table above and multiply the path, then do the same for the service and the load balancer. `survive any node failure` removes one replica of each node and re-checks saturation and latency, so a node with one replica fails it.

```callout tip The simulation's arithmetic is the floor
The real-world argument often asks for more. With quorum writes (W=2), a store with only two copies of a key can't take a quorum write while one of them is down, which is why Dynamo-style stores usually run N=3. Decide which argument you're making and say it out loud.
```

**Cost.** The store is the expensive line. Price your replica counts against the $3,000 limit before running the analysis, and don't pay for replicas that neither availability nor load needs.

### Step 4: Wrap up

"A stateless cart service over a leaderless, replicated store. Adds go to any replica, so they're accepted during failures. Concurrent writes leave versions; reads merge them by union and write the result back. We accept that a deleted item may reappear; we never lose an add." Then name the edges: checkout (re-validate the cart against a strongly consistent order system), bounding version growth, and monitoring conflict rates.

## Common mistakes

**Carts in PostgreSQL** (`wrong/carts-in-postgres`). The most natural first answer, and wrong here. Every add goes to one primary per shard; when it fails, adds are rejected until a replica is promoted: in the real world, a burst of failed adds during every failover and every primary maintenance window. Caught twice: **Adds go to an eventually consistent store that is always writable** (PostgreSQL is a strong store) and **availability of Add to cart ≥ 99.999%** (writes reach 99.995% at best).

**Carts in Redis** (`wrong/carts-in-redis`). Fast and always writable, so tempting. But a cache keeps data in memory: a restart, an eviction or a failover with asynchronous replication can drop adds the shopper already saw confirmed. Caught by **Add to cart is durable**.

**Last write wins** (`wrong/last-write-wins`). The design reads both versions and keeps the newest, writing nothing back. Two tabs (or one shopper on phone and laptop) add different items at the same moment, and one add silently disappears; clock skew between servers makes "newest" unreliable too. Caught by **Divergent versions are merged and written back**.

**Merging without writing back.** The view looks right, but the conflict is never resolved: every reader pays for the merge and versions accumulate. Also caught by **Divergent versions are merged and written back**.

**A single store replica.** A single point of failure: 99.99% alone, short of five nines before the rest of the path counts. Caught by **availability of Add to cart ≥ 99.999%** and `survive any node failure`. Two replicas pass the simulation's arithmetic; a real quorum system wants a third, so a write quorum survives losing one copy.

## In the interview

```callout interview Start from the business
"A rejected add is a lost sale, a stale cart is not." Derive AP from that, then pick the store. Show the availability arithmetic for primary-based vs leaderless writes: it's short and convincing. Then the conflict story: versions, merge by union, write back, and the deleted-item trade-off stated plainly. Interviewers love it when you name the cost of your choice before they do.
```

Follow-up questions:

- **"What are N, R and W, and what would you pick?"** N=3, W=2, R=2 is the common balance; an always-writable cart might lower W to 1, accepting writes with one replica reachable, at the cost of staler reads.
- **"How do you detect concurrent versions?"** Vector clocks: if neither clock descends from the other, the versions are concurrent.
- **"Why not last write wins?"** Timestamps across machines aren't reliable, and LWW discards one of two concurrent adds by design.
- **"How do you handle deletes?"** A deleted item can come back after a merge. If that's unacceptable, record deletes as entries (tombstones) the merge can see: the idea behind CRDTs (conflict-free replicated data types).
- **"Where do you need strong consistency?"** At checkout: prices, stock and payment go through a strongly consistent order system.
- **"How do replicas catch up after an outage?"** Hinted handoff for writes accepted elsewhere, read repair when a read finds a stale replica, and background anti-entropy (Merkle trees) for the rest.

## Further reading

- [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) (DeCandia et al., SOSP 2007): the primary source. The shopping cart, sloppy quorums, vector clocks and the 99.9th-percentile SLA all come from here.
- [Amazon's Dynamo](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html) (Werner Vogels): a short introduction to the paper and why Amazon built it.
- [System Design Primer: Availability vs consistency](https://github.com/donnemartin/system-design-primer#availability-vs-consistency): CAP, with the CP and AP choices summarised.
- [System Design Primer: Eventual consistency](https://github.com/donnemartin/system-design-primer#eventual-consistency): the consistency patterns side by side.
- [System Design Primer: Availability in numbers](https://github.com/donnemartin/system-design-primer#availability-in-numbers): downtime per year for each number of nines, and the sequence/parallel formulas.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu), chapter "Design A Key-value Store": quorums, vector clocks and failure handling in a Dynamo-style store, in interview form.
- [How the simulation works](https://proschi.app/docs/model/): section 1.7 explains how the model computes availability, including single-primary failover.
