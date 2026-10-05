## What you'll learn

- The **availability vs consistency** trade-off, and how a business requirement ("never reject an add") picks a side for you.
- Why a **single-primary** database can't promise five nines for writes, and how **leaderless replication** can.
- What **quorums** (N, R, W) are and how they tune the trade-off.
- How **versioning and merge-on-read** keep every add when concurrent writes conflict, and what that merge costs.
- How to count **nines**: what 99.999% means in minutes, and how replicas get you there.

## The problem, explained

This problem is modelled on a real system. In 2007 Amazon published the paper on **Dynamo**, the key-value store they built because some services, the shopping cart first among them, must stay writable no matter what is failing. Their argument was blunt: if "Add to cart" fails, the customer may leave and the sale is gone. A cart that is briefly out of date is a minor annoyance. A rejected add is lost revenue.

Two use cases:

- **Add to cart**: a shopper adds an item and gets `200`. The add is durable before that answer.
- **View cart**: a shopper opens their cart and gets `200`, with two scenarios:
  - `"One version"`: the store holds a single version of the cart (the usual case).
  - `"Divergent versions"`: two writes raced, or a node was cut off from the others, so the store returns several versions. The service merges them so no add is lost, and writes the merged cart back before answering.

The non-functional requirements:

- **Scale**: 500 adds and 1k cart views per second at peak. In Amazon's measurement, 99.94% of reads saw exactly one version.
- **Latency**: the **99.9th percentile** (p99.9) of both use cases under 300 ms. That is the SLA (service level agreement) the Dynamo paper uses as its example. Amazon measured the tail, not the average, because the slowest requests often belong to the most valuable customers (those with the longest histories).
- **Availability**: Add to cart works **99.999%** of the time ("five nines").
- **Durability**: an add survives once the shopper hears `200`.
- **Consistency**: carts live in an eventually consistent store, because a strongly consistent one must refuse writes it cannot coordinate.
- **Fault tolerance**: losing any single machine doesn't take the cart down.
- **Budget**: $3,000 a month.

`given.proschi` declares the `shopper` and the traffic mix (`"One version"` 99.94%, `"Divergent versions"` 0.06%), the requirements and two tests:

1. **Adds go to an eventually consistent store that is always writable**: Add to cart writes a database before answering, never calls a *strong* store, and answers `200`.
2. **Divergent versions are merged and written back**: View cart has a `"Divergent versions"` scenario, and that scenario writes to a database before answering.

## Back-of-the-envelope

| Quantity | Arithmetic | Result |
|---|---|---|
| Write share | 500 ÷ (500 + 1,000) | one request in three is a write |
| Merges per second | 1,000 × 0.06% | ≈ 0.6 |
| Writes to the store | 500 adds + 0.6 merges | ≈ 500 rps |
| Reads from the store | 1,000 views | 1,000 rps |
| Five nines, per year | 525,600 min × 0.001% | ≈ 5.3 minutes of downtime |
| Five nines, per month | 43,200 min × 0.001% | ≈ 26 seconds of downtime |
| Cart data (assumption) | 50 M carts × 2 KB | ≈ 100 GB |

The cart count and size are assumptions to show the method; even a much larger number fits one store with replicas. **Storage and throughput are not the hard part here. Availability is.** Twenty-six seconds of downtime a month is less than one database failover takes.

Now look at availability per component, using the simulation's default numbers:

| Component | Up per replica | With 2 replicas | With 3 replicas |
|---|---|---|---|
| Load balancer | 99.99% | 99.999999% | — |
| Service (`[REST API]`) | 99.5% | 99.9975% | 99.99999% |
| Leaderless NoSQL (`[DynamoDB]`) | 99.99% | 99.999999% | ≈ 100% |
| Relational (`[PostgreSQL]`), **writes** | 99.95% | 99.995% | 99.995% |

The last row is the key insight. In the model, as in real life, a relational database has **one primary per shard** that takes every write. Replicas serve reads and can be promoted when the primary dies, but writes wait out the promotion. The simulation keeps 10% of the primary's downtime for that, so writes reach 99.995% however many replicas you add: **below five nines, by design.** A leaderless store takes a write on any replica, so each replica you add cuts its unavailability by another factor.

The path availability is the product of the nodes on it. Work it out for your design: with enough replicas of every node, Add to cart comes out far above 99.999%.

Load and latency:

- The store sees about 1,000 reads and 500 writes per second against 20,000 of each per replica, so it is nearly idle.
- The service sees 1,500 rps against 2,000 per replica. One replica would already be 75% busy, and you need more than one anyway for availability.
- Latency: a load balancer (~2 ms), a service (~10 ms) and a store (~5 ms) add up to well under 300 ms even at p99.9, where an idle hop is about 4× its mean. The latency limit is there to catch saturated designs, not to make you optimise.
- Cost: the leaderless store costs about $500 per replica per month, a service $100, a load balancer $50. Multiply out before you run.

## Concepts

### Availability vs consistency

**What it is.** When the network splits replicas apart (a *partition*), a replicated store must choose: refuse requests it can't coordinate (stay *consistent*: every read sees the latest write), or accept them and reconcile later (stay *available*). That's the CAP theorem in one sentence. Even without partitions, coordinating every write costs latency, and a single coordinator, such as a primary, is a single place where writes stop.

**Why it matters here.** The business has already chosen: an add must never be rejected. That makes the cart an **AP** system (available under partition), and consistency becomes *eventual*: replicas converge once they can talk again.

**Trade-offs.** Readers may briefly see an older cart, and two versions may coexist. The application must handle that.

**When not to choose availability.** Money, inventory counts, unique usernames: anything where two conflicting "yes" answers can't be merged afterwards. You'll meet those in the consistency stage of this roadmap.

```proschi
title "Strong vs eventual"

app    "App"          [REST API]   x2
ledger "Ledger"       [PostgreSQL] x2 "Strong: one primary orders every write"
prefs  "Preferences"  [Cassandra]  x3 "Eventual: any replica takes a write"

app -> ledger : SQL
app -> prefs  : CQL
```

### Leaderless replication and quorums

**What it is.** In a leaderless store (Dynamo, Cassandra, Riak), every key is copied to **N** replicas. A write is sent to all N and counts as successful once **W** of them acknowledge; a read asks the replicas and waits for **R** answers. With N=3, W=2, R=2 (the configuration the Dynamo paper describes as common), any read overlaps any successful write on at least one replica, because R + W > N.

**Why it's always writable.** No replica is special, so losing one doesn't stop writes. Dynamo goes further with a *sloppy quorum*: if some of a key's usual replicas are unreachable, the write goes to the next healthy nodes, which hold it as a *hint* and hand it back when the owners return (*hinted handoff*). The add is accepted and durable even mid-failure.

**Trade-offs.** Lower W means faster, more available writes but a greater chance of reading stale data. Concurrent writes to different replicas create **conflicts** that someone has to resolve. Operations get harder: background repair (Dynamo uses Merkle trees to compare replicas) and membership gossip.

**When not to use it.** When you need transactions across keys, unique constraints or strict ordering. A relational database with a primary is simpler and gives you those.

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

### Versioning and merge on read

**What it is.** If two writes to the same cart land on different replicas without seeing each other, neither is "newer": they are *concurrent*. Dynamo tags every version with a **vector clock**, a small list of (node, counter) pairs. Comparing two clocks tells you whether one version descends from the other (keep the descendant) or whether they're concurrent (keep both). A read that finds concurrent versions returns all of them to the application.

**Why merge in the application.** Only the application knows what a cart *means*. Taking the **union** of the items in both versions keeps every add. The merged cart is written back with a clock that descends from both, so the conflict is resolved for every later reader.

**Trade-offs.** The union can bring back an item the shopper deleted in one of the versions. Amazon judged that acceptable: a resurrected item is a nuisance, a lost add is a lost sale. The alternative, **last write wins** (keep the version with the latest timestamp), is simple and silently drops one of two concurrent adds.

**When not to use it.** When there's no meaningful merge (two people booking the last seat), or when conflicts are so rare and harmless that last-write-wins is fine (a "last seen" timestamp).

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

A note on names: the 2007 Dynamo paper and today's Amazon DynamoDB service are not the same system. DynamoDB doesn't hand you vector clocks or sibling versions; you'd use conditional writes instead. In Proschi, `[DynamoDB]` simply stands for a leaderless, eventually consistent store, which is the property this problem is about.

## Designing it step by step

### Step 1: Scope

Ask what failure means to the business. "If the cart can't take an add for 30 seconds, what happens?" The answer here, lost sales, is what justifies everything else. Then confirm the numbers: 500 adds, 1k views, five nines on adds, p99.9 under 300 ms. Note what's out of scope: checkout, prices, inventory. Checkout is where you *do* want strong consistency, and it's a different service.

### Step 2: High-level design

Shopper → load balancer → cart service → store. The service is stateless; all state is in the store. Draw the two use cases, and for View cart write both scenarios with `alt` and `when` conditions that explain them.

The first real decision is the store. Put the options side by side:

- **Relational with replicas.** Familiar, transactional, but every add needs the one primary, and a failover blocks adds. Writes cap out around 99.995%.
- **An in-memory cache.** Fast and always writable, until a node restarts and the adds are gone.
- **A leaderless, eventually consistent store.** Any replica takes a write; durability comes from writing to several disks. The cost is conflict handling.

The third is the one that fits the requirement, and the tests check that adds never touch a strong store.

### Step 3: Deep dive

**The add.** The service writes the cart with its version information and answers `200` only after the store acknowledges. No queues, no write-behind: the add must be durable before the answer.

**The view.** Read every version. In `"One version"` there's nothing to do. In `"Divergent versions"`, merge (union of items), **write the merged cart back**, then answer. Writing back matters: without it, every future read sees the conflict again and the versions keep piling up.

**Replication.** How many replicas of the store does five nines take? Use the table above and multiply the path, then do the same for the service and the load balancer. Remember that `survive any node failure` removes one replica of each node and re-checks saturation and latency, so a node with one replica fails it. The simulation's arithmetic is the floor, and the real-world argument often asks for more. With quorum writes (W=2), a store with only two copies of a key can't take a quorum write while one of them is down, which is why Dynamo-style stores usually run N=3. Decide which argument you're making and say it out loud.

**Cost.** The store is the expensive line. Price your replica counts against the $3,000 limit before running the analysis, and check that you're not paying for replicas that neither availability nor load needs.

### Step 4: Wrap up

"A stateless cart service over a leaderless, replicated store. Adds go to any replica, so they're accepted during failures. Concurrent writes leave versions; reads merge them by union and write the result back. We accept that a deleted item may reappear; we never lose an add." Then name the edges: what happens at checkout (re-validate the cart against a strongly consistent order system), how to bound version growth, and how you'd monitor conflict rates.

## Common mistakes

**Carts in PostgreSQL** (`wrong/carts-in-postgres`). The most natural first answer, and wrong for this requirement. Every add goes to one primary per shard; when it fails, adds are rejected until a replica is promoted. In the real world that is a burst of failed adds during every failover and every primary maintenance window. Caught twice: **Adds go to an eventually consistent store that is always writable** (PostgreSQL is a strong store) and **availability of Add to cart ≥ 99.999%** (writes reach 99.995% at best).

**Carts in Redis** (`wrong/carts-in-redis`). Fast and always writable, which makes it tempting. But a cache keeps data in memory: a restart, an eviction or a failover with asynchronous replication can drop recent adds that the shopper already saw confirmed. Caught by **Add to cart is durable**.

**Last write wins** (`wrong/last-write-wins`). The design reads both versions and keeps the newest, without writing anything back. Two shoppers' tabs (or one shopper on phone and laptop) add different items at the same moment, and one add silently disappears. Clock skew between servers makes "newest" unreliable too. Caught by **Divergent versions are merged and written back**.

**Merging without writing back.** The view looks right, but the conflict is never resolved, so every reader pays for the merge and versions accumulate. Also caught by **Divergent versions are merged and written back**.

**A single store replica.** One replica of the store is a single point of failure: 99.99% on its own, short of five nines before the rest of the path is counted. Caught by **availability of Add to cart ≥ 99.999%** and `survive any node failure`. Two replicas pass the simulation's arithmetic; in a real quorum system you'd still want a third, so that a write quorum survives the loss of one copy.

## In the interview

**How to present it.** Start from the business: "a rejected add is a lost sale, a stale cart is not." Derive AP from that, then pick the store. Show the availability arithmetic for primary-based vs leaderless writes. It's short and convincing. Then the conflict story: versions, merge by union, write back, and the deleted-item trade-off stated plainly. Interviewers love it when you name the cost of your choice before they do.

Follow-up questions:

- **"What are N, R and W, and what would you pick?"** N=3, W=2, R=2 is the common balance; for an always-writable cart you might lower W to 1 to accept writes with only one replica reachable, at the cost of staler reads.
- **"How do you detect concurrent versions?"** Vector clocks: if neither clock descends from the other, the versions are concurrent.
- **"Why not last write wins?"** Timestamps across machines aren't reliable, and LWW discards one of two concurrent adds by design.
- **"How do you handle deletes?"** A deleted item can come back after a merge. If that's unacceptable, record deletes as their own entries (tombstones) so the merge can see them, which is the idea behind CRDTs (conflict-free replicated data types).
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
