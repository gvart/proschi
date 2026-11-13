# Config Distribution: write once, copy everywhere, read locally

```tldr
Configuration is **read on every request** but **changed rarely**. Keep a full copy on **every edge server** and read it there, so requests never leave the machine and survive the core going away. Write each change **once, to a replicated root**, answer the customer, then copy it **asynchronously down a tree** of main nodes, so no machine has to send it to everyone.
```

## What you'll learn

- Why a read path that runs on every request must not depend on a central store, and what a local copy costs you.
- How a single writer with sequence numbers makes replication simple, and why that writer needs a standby.
- Why the copy to the edge happens after the answer, and what "within seconds" means for the design.
- How a fan-out tree turns one machine sending to hundreds into many machines sending to a few, and how to size its middle tier.
- How this differs from a cache in front of an origin.

## The problem, explained

Every request Cloudflare serves needs configuration. Is this hostname a customer? Which firewall rules apply? Which Worker runs? What is the load-balancing weight of the second origin? The answers are written by customers, through the dashboard and the API, and they must be on every machine that serves traffic, in some 200 cities, a few seconds after the customer saves them.

Cloudflare's first system for this was Kyoto Tycoon (KT): central services wrote to root nodes, which fed a management node in each data center, which fed every server. It worked until scale broke it. Writes blocked reads, crashes corrupted databases, replication could silently skip entries, and failing over the root needed a human. Cloudflare replaced it with **Quicksilver**: the same shape of tree, rebuilt around LMDB, an embedded key-value store that every edge server keeps on its own disk.

Two use cases:

- **Serve request**: an edge server answers a visitor, reading three settings from its local store.
- **Change config**: a customer changes a setting and gets `200` once the change is stored; the change then reaches every data center in the background.

The rates are assumptions sized from the post: 1M requests a second at the edge (Cloudflare reports over 14M at peak), 1k changes a second at peak (it reports about 30 million writes a day), 2 KB per change. The limits are a p99 under 20 ms for requests and 100 ms for changes, 99.99% availability, surviving the loss of any machine, the root included, and $5,000 a month.

**What the tests check**: requests read `local` in every scenario and never `root` or `mains`; a change is written to `root` before the answer and the customer never waits for `mains` or `local`; the root sends to the main nodes, the main nodes to the local stores, and nothing goes from the root straight to the edge.

```deepdive What the model leaves out
The simulation has no clock for work done after the answer, so it cannot say how long a change takes to reach the edge. Async copies show up as load and bytes, which is enough to decide the shape of the tree but not its speed. Batching, sequence numbers and catch-up are taught below, not graded.
```

## Back-of-the-envelope

The simulation's `[Key-Value Store]` node serves about 20k operations a second, carries 100 MB/s and costs $500 a month. The local store on an edge server takes 50k reads a second.

```numbers
3M/s | configuration reads at the edge
200k/s | store writes after fan-out
400 MB/s | bytes reaching the edge
12 MB/s | what the root sends through a tree
6 | main nodes, one of them spare
$4,200 | monthly cost
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Configuration reads | 1M requests × 3 | 3M/s |
| Reads per data center | 3M ÷ 200 | 15k/s, 30% of a local store |
| Central nodes to serve them | 3M ÷ 20k | 150 at 100% |
| Store writes after fan-out | 1k changes × 200 | 200k/s, 1k per data center |
| Bytes to the edge | 200k × 2 KB | 400 MB/s |
| Root sending to every data center | 400 ÷ (2 × 100) | 200%: saturated |
| Root sending to 6 main nodes | 1k × 6 × 2 KB | 12 MB/s, 6% |
| Main tier traffic | 400 out + 12 in | 412 MB/s |
| Six main nodes, one down | 412 ÷ 500 | 82% |
| Five main nodes, one down | 410 ÷ 400 | 103%: saturated |
| Cost | 2 × $100 + 2 × $500 + 6 × $500 | $4,200 |

Two numbers decide the design. Reads outnumber writes 3,000 to 1, so the read path must be as cheap as possible: a lookup on the local disk. And every write is multiplied by the number of data centers, so the copying has to be spread over more machines than the one that took the write.

```quiz
config-push-fan-out-bandwidth
fanout-write-amplification
```

## Concepts

### Read locally, never from the core

Configuration is read on every request, which makes its read path part of every request's latency and availability. If an edge server asked a central store, a request in Sydney would wait for a round trip to wherever that store lives, and a cut fibre between Sydney and the core would take Sydney down. Cloudflare's post states the rule plainly: each data center must be able to serve requests even when cut off from any source of central configuration.

So each edge server holds a **full copy** of the configuration, on its own disk, and reads it there. Quicksilver uses LMDB, a memory-mapped B-tree that many processes on the machine can read at once and that answers in microseconds. The post reports about 2.5 trillion reads a day, at an average latency in microseconds. For the DNS service, moving from KT to Quicksilver cut the p99 of reads by two orders of magnitude.

The price is twofold. Every server stores everything, which works for configuration and not for user data. And a local copy is **stale** for as long as replication takes: a change saved now is served a few seconds later, fine for settings, not for a bank balance.

```callout takeaway
Put the data a request needs **on the machine that serves the request**. Then the request's latency and availability no longer depend on anything else.
```

```quiz
config-push-local-reads
availability-in-series
```

### This is not a cache

The Tiered CDN Cache problem also has edges and a tier above them, but its edges hold a **subset** of the data and fetch what they miss from the origin. Here there are no misses: every edge holds **every key**, and a read never leaves the machine. A cache needs a path to the source on the request path; a replicated store does not. That is what lets a data center run while cut off, and what makes the write side the hard part.

### The root: single writer, replicated

Writes are rare compared with reads: thousands a second against millions. That allows a simplification most databases cannot afford: **one place takes every write**. Cloudflare picks a single data center to aggregate writes. It gives each change the next number of a **monotonically increasing sequence**, so every replica applies changes in the same order, and a replica that sees entry 25 after 23 knows it missed 24 and can ask for it again.

Because every write passes through it, the root is the one machine whose loss stops every change. KT's root needed a person to promote the standby, so a root failure meant configuration stopped propagating for a while. Quicksilver runs a primary and a secondary. In the model, one root node fails `survive failure of root`, and its 99.99% availability multiplied by the API's drops Change config under the 99.99% limit.

Note what does **not** break when the root is down: requests. The edge keeps serving the last configuration it received. That separation, between the part that changes the system and the part that runs it, is why the read path never touches the root.

```quiz
config-push-single-writer
three-replicas-parallel
```

### Write once, copy in the background

A change is durable once the root has it. Copying it to 200 data centers takes longer and depends on all of them, so it must not hold the customer's request. The API writes to the root, answers `200`, and the copy runs after the answer. In Proschi that is an async send, `->>`, placed after the response.

If the API waited for every data center, the slowest of 200 would set every write's latency, and one unreachable data center would block every change. With many independent replicas, waiting for all is waiting for the worst.

What the customer gets in exchange is **eventual** delivery: the change is saved now and live everywhere a few seconds later. Cloudflare measures that gap by writing a heartbeat at the top of the tree and comparing its time on each server, because a lagging replica looks healthy until someone notices their change is not taking effect.

```callout pitfall
"Durable" and "delivered" are different moments. Answer at the first, and **measure** the gap to the second instead of waiting for it.
```

```quiz
sync-vs-async-replication
fan-out-tail-latency
```

### A fan-out tree

Each change must be copied 200 times. If the root does all the copying, it sends 200 × 2 KB per change: 400 MB/s at 1k changes a second, twice what two root nodes carry. Adding root nodes would spread the bytes but not the job: every one of them would still talk to every data center over long links.

A **tree** spreads the work. The root sends each change to a handful of **main nodes**; each main node sends it on to its share of data centers. The root's traffic drops to 12 MB/s, and the 400 MB/s that must reach the edge is shared by the main tier. Quicksilver does exactly this: edge nodes replicate from main nodes, which replicate from the top-mains. Each node usually replicates from a close neighbour, so the long links carry one copy per region instead of one per server.

Size the middle tier like any pool. It moves about 412 MB/s (what it sends, plus what it receives); at 100 MB/s a node, five would run at 82% and saturate when one fails, so six it is: 69% normally, 82% with one down.

```callout tip
A tree trades a little delay (one more hop) for a lot of headroom: no node sends more than its share, and adding data centers means adding main nodes, not a bigger root.
```

```deepdive How Quicksilver replicates
Replication is pull-based: a node asks its parent for every log entry after the last sequence number it has. Log entries live in the same LMDB file as the data, in a separate bucket, so an entry and the change it describes are committed together. Updates from a 500 ms window are batched into one disk write, which made durable writes affordable. Each instance has primary and secondary sources; the secondary main nodes keep a much longer history, so a machine that was offline for a week can still catch up. Each database has a unique id, required to start replicating, and a random process id stops a node from replicating from itself.
```

## Designing it step by step

### 1. Scope the problem

Ask how often configuration is read and how often it changes, how fast a change must be live everywhere (seconds), and what happens to a data center that loses its link to the core (it must keep serving). Those three answers set the design: local reads, a single writer, async copies.

### 2. High-level design

| Use case | Path | Why |
|---|---|---|
| Serve request | visitor → edge → local | Reads never leave the server |
| Change config | customer → API → root, answer | Durable on one replicated writer |
| (after the answer) | root → main nodes → local | The copy spreads over a tree |

### 3. Deep dive

**The read path.** Three lookups on the local store per request: 15k reads a second per data center, 30% of its read capacity, next to 1k replicated writes.

**The root.** Two nodes, a primary and a secondary. It takes 1k writes a second and sends 12 MB/s.

**The main tier.** Six nodes, sized for 412 MB/s with one down. Write the fan-out with prefixes, so the simulation counts every copy and every byte.

**Freshness.** Explain how a change reaches the edge in seconds and how you would know if it did not.

### 4. Wrap-up

Summarise: read locally, write once to a replicated root, copy asynchronously down a tree. Name next steps: monitoring lag per server, sharding configuration into separate databases by kind (Cloudflare runs separate instances for DNS and Page Rules), and protecting against a bad change spreading as fast as a good one.

## Common mistakes

**Reading the central store on every request** (`wrong/read-the-central-store.proschi`). The edge asks the root for its settings. 3M reads a second land on two nodes that serve 40k, the root saturates, and requests and changes both slow down; even if it were big enough, every data center would depend on its link to the core. It fails the p99 of Serve request and "Edge requests read the local copy".

**The root sending to every data center** (`wrong/root-sends-to-every-edge.proschi`). No main nodes: the root sends 400 MB/s against 200 MB/s of capacity and saturates, which slows the writes that go through it. It fails the p99 of Change config and "Changes reach the edge through the main nodes".

**Waiting for every data center** (`wrong/wait-for-every-edge.proschi`). The copy runs inside the request. The model counts a fan-out's latency once, so the numbers barely move (in reality the slowest data center would decide): only with an API node down does the p99 of Change config cross 100 ms. It fails "A change is written once, then copied in the background", and `survive any node failure`.

**A single root** (`wrong/single-root.proschi`). The tree is right, but its top is one machine. Losing it stops every change, and Change config's availability drops under 99.99%. It fails `survive failure of root` and the availability limit.

## In the interview

Lead with the ratio and the outage rule: "reads are thousands of times more frequent than writes, and a data center must serve when cut off, so every server keeps a full local copy." The rest of the design follows from making that copy arrive.

```callout interview Say where each guarantee comes from
"Requests are fast and available because they read the local disk. Changes are durable because the root has them, ordered because the root numbers them, and delivered in seconds because a tree copies them in the background."
```

Expected follow-ups:

- **How do you know a change reached every server?** Write a heartbeat at the root and compare its timestamp on every server; alert on lag, not just on errors.
- **A server was offline for a day. How does it catch up?** It asks for every entry after its last sequence number; keep enough history (Quicksilver's secondary main nodes keep a week), and fall back to a full copy beyond that.
- **What if a bad configuration change is pushed?** It spreads as fast as a good one. Validate before writing, roll out risky kinds of change in stages, and keep the ability to write the old value back quickly.
- **Why not a cache with a TTL?** A miss would go to the core on the request path, and a data center cut off from the core would start failing as entries expire.
- **The root's data center goes down. What happens?** The secondary takes over writes; until then changes queue up, but every edge keeps serving.

## Further reading

- [Introducing Quicksilver: Configuration Distribution at Internet Scale](https://blog.cloudflare.com/introducing-quicksilver-configuration-distribution-at-internet-scale/), Geoffrey Plouviez, Cloudflare blog, 2020: the post this problem is based on, from KT's failures to LMDB, batching and the fan-out tree.
- [LMDB](http://www.lmdb.tech/doc/): the embedded, memory-mapped key-value store Quicksilver keeps on each server.
- [Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/), Amazon Builders' Library: why the data plane should keep working when the control plane is down.
- [System Design Primer: Replication](https://github.com/donnemartin/system-design-primer#replication): master-slave replication and its trade-offs.
- *Designing Data-Intensive Applications* (Martin Kleppmann), chapter 5, "Replication": leaders and followers, replication logs, and lag.
