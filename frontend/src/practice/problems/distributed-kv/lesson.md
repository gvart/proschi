# Distributed Key-Value Store: quorums on a ring

Most of the problems on this roadmap use a store like DynamoDB or Cassandra as a box. This one opens the box. A Dynamo-style store has no leader: every key lives on a few machines picked by hashing, any of them takes reads and writes, and the client decides how many must answer. With those few ideas it keeps accepting writes while machines fail, and the price is that two readers can briefly see different values. This lesson builds that store from the ring up.

## What you'll learn

- How consistent hashing with virtual nodes places keys on machines, and why `hash(key) mod n` does not.
- What N, R and W mean, why R + W > N makes reads see the latest write, and what each choice costs.
- How a sloppy quorum with hinted handoff keeps writes available when a replica is down.
- How read repair and anti-entropy bring stale replicas back in line.
- How replication multiplies load, and how to size replica groups for the loss of a node.

## The problem, explained

**Who uses it.** Application servers that keep small values by key: sessions, carts, user settings. They want a put and a get, fast, and they never want a write refused.

**Functional requirements.**

- **Put** stores a value under a key and answers `204`. It goes to the key's three replicas and succeeds once two have it, also in the `"Replica down"` scenario, where one does not answer.
- **Get** reads the value, asking two replicas. In the `"Stale replica"` scenario one of them returns an older version.

**Non-functional requirements.** p99 (the latency 99% of requests beat) under 60 ms for both. Available 99.99%. Losing any machine breaks no latency limit. At most $9,500 a month.

**What is given, and why.** `given.proschi` declares the application servers and the storage nodes with three replicas: the replication factor, N = 3, is fixed. How many replica groups (shards) the ring has is yours to choose with `capacity { nodes shards <n> }`, and each one is three more $500 machines. That one number is most of the bill.

**What the tests check.**

- *Clients reach the storage nodes through the coordinators*: both use cases start at the application servers, which have no path to the storage nodes.
- *A write survives a replica that is down*: Put has a `"Replica down"` scenario with a failed call to a storage node, and it still answers `2xx`.
- *A read repairs a stale replica*: in `"Stale replica"`, Get writes to the storage nodes before it answers.
- *Reads come from the replicas, not a cache*: Get never calls a cache.

## Back-of-the-envelope

| Quantity | Arithmetic | Result |
|---|---|---|
| Client requests | 10k puts + 30k gets | 40k rps |
| Replica writes | 10k × N = 3 | 30k/s |
| Replica reads | 30k × R = 2 | 60k/s |
| Replica operations | 30k + 60k | 90k/s |
| One storage node | 20k reads + 20k writes | uses a share of each |
| Data per day, upper bound | 10k × 1 KB × 86,400 | about 860 GB written, before overwrites |

**Replication multiplies load.** Clients make 40k requests a second, but the storage nodes do 90k operations. Every write lands on all three replicas, because even a write acknowledged by two still has to reach the third. Every read asks two.

**How busy is a node?** In the model a partitioned store serves reads and writes on every replica, and its utilisation is the sum of both shares. With S shards there are 3S nodes. Per node: 60k ÷ 3S reads of 20k, plus 30k ÷ 3S writes of 20k, which is 1.5 ÷ S.

| Shards | Nodes | Busy, all up | Busy, group with a node down | Cost of nodes |
|---|---|---|---|---|
| 2 | 6 | 75% | 113%, saturated | $3,000 |
| 3 | 9 | 50% | 75% | $4,500 |
| 4 | 12 | 38% | 56% | $6,000 |
| 5 | 15 | 30% | 45% | $7,500 |

**The coordinators.** Every client request passes one coordinator: 40k requests at about 2k each is 20 replicas at 100%. Keep them under 70% and check the count with one replica gone.

**Latency.** A Put or Get is one coordinator hop (10 ms in the model) and one parallel round to the replicas (5 ms). The replicas' queueing is what changes with the number of shards, and it shows in the p99 most when a node is down.

## Concepts

### Consistent hashing and virtual nodes

Hash every key onto a ring of, say, 2^64 positions, and give every node a position on the same ring. A key belongs to the first node clockwise from its hash, and its replicas to the next two distinct nodes after that. That list of three is the key's *preference list*.

Why not `hash(key) mod n`? Because changing n moves almost every key: going from 11 to 12 nodes changes the answer for about 11 keys in 12. On a ring, a new node takes over only the slice between itself and its predecessor; everything else stays where it was.

One position per node spreads load badly: the slices are random lengths, and when a node leaves, its whole slice falls onto one neighbour. So each machine takes many positions, *virtual nodes* (Cassandra used 256 by default for years, now 16 with a smarter allocator). The slices even out, a leaving machine's load spreads over many others, and a bigger machine can simply take more virtual nodes.

In the simulation, the ring is the shard count: `shards 4` with `x3` is twelve machines in four groups of three, each key on one group.

### Replication and quorums

Each write goes to the key's N replicas. The client, or the coordinator acting for it, waits for W acknowledgements before it answers; a read asks R replicas and returns the newest version among them. If **R + W > N**, every read set overlaps every write set in at least one replica, so a read always meets the latest acknowledged write.

| Setting | Effect |
|---|---|
| N = 3, W = 2, R = 2 | Overlap guaranteed; one replica can be down for reads and writes |
| W = 3 | Every write waits for the slowest replica; one down fails the write |
| R = 3 | Every read waits for the slowest; a third more read load |
| R = 1, W = 1 | Fastest, cheapest, and a read can miss an acknowledged write |

The quorum is not free. W = 2 still sends the write to all three: the third copy is what makes a later read quorum overlap. R = 2 doubles the read load compared with reading one replica. In Proschi, write the prefixes `x3 PUT …` and `x2 GET …` so the simulation counts the operations; its latency counts the step once, as if the calls went out in parallel, which is what a coordinator does.

```proschi
title "Quorum writes on a settings store"

svc   "Settings API" [REST API]  x3
store "Settings"     [Cassandra] x3

svc -> store : CQL

usecase "Save setting" {
  svc    -> store : x3 UPDATE setting at QUORUM
  store --> svc   : two acks
}
```

A cache in front of a quorum store breaks the guarantee: a cache hit is one copy that no quorum vouches for, and a write acknowledged by two replicas never reaches it. If reads are too expensive, add replica groups; that is what the ring is for.

### Sloppy quorums and hinted handoff

A strict quorum counts only the key's own three replicas. When one is down, W = 2 still works; when two are down, writes fail. Dynamo went further with a *sloppy quorum*: the write goes to the first N *healthy* nodes on the ring, so a stand-in takes the copy meant for the dead node. The stand-in keeps it with a *hint* naming the intended owner and hands it back when the owner returns (*hinted handoff*).

What it buys: writes keep succeeding through failures, which Amazon wanted for the shopping cart. What it costs: while a hint is outstanding, the copies are not on the key's home replicas, so R + W > N no longer guarantees that a read sees the write. Cassandra keeps hints but does not count them toward the consistency level; Riak lets you choose.

In the model, the `"Replica down"` scenario writes two replicas, answers, then shows the call to the third failing (`-x`) and the hinted copy going to another node. Those last steps come after the response, so they cost load but no latency.

### Read repair and anti-entropy

Replicas drift: a node that was down missed writes, a hint was lost, a write reached two replicas and the coordinator crashed before the third. Two mechanisms bring them back.

- **Read repair.** When a quorum read sees two versions, the coordinator writes the newer one to the replica that returned the older. If it does so before answering (*blocking* read repair, Cassandra's behaviour for quorum reads), a value one reader saw cannot vanish for the next quorum reader: reads are monotonic. The cost is one extra write on the 2% of reads that find a stale replica.
- **Anti-entropy.** Read repair only fixes keys that are read. A background process compares replicas key range by key range using *Merkle trees*: each node hashes its keys into a tree, two replicas compare roots, and they descend only into the subtrees that differ. Two replicas that agree exchange one hash.

### Versions and conflicts

Without a leader, two clients can write the same key at the same time through different coordinators. Which wins? *Last write wins* by timestamp is simple and loses data: one of the two writes disappears, and a node with a fast clock wins every race. Dynamo attached a *vector clock* to each value instead: a counter per coordinating node. If one clock descends from the other, the newer value replaces the older; if neither does, the writes were concurrent and the store keeps both siblings and returns them to the next reader to merge. The shopping cart merged by taking the union of items.

### Sizing for a lost node

Load is spread over a key's replica group, and a key cannot move to another group when one of its nodes dies. So the group, not the cluster, is what must survive: when one of three nodes is gone, the other two carry the group's load, 1.5 times what each carried before. A group at 50% becomes 75%, where queueing makes every hop several times slower at the tail. Size so the degraded group stays comfortably below 70%, which here means four shards rather than three. Real clusters have a second reason for the headroom: the surviving replicas also stream data to the replacement node.

## Designing it step by step

**1. Clarify.** Value size (about 1 KB), rates (10k puts, 30k gets), replication factor (3), what must keep working when a machine fails (writes), and how stale a read may be. Agree that conflicting concurrent writes are kept and merged, not silently dropped.

**2. Route.** Put a coordinator tier between the application servers and the storage nodes. A coordinator hashes the key, finds its preference list on the ring and talks to the replicas. (Dynamo lets any storage node coordinate, or a ring-aware client library; a separate tier is the same idea drawn as its own box.)

**3. Write path.** Send the write to all three replicas and answer after two acknowledge. For `"Replica down"`, answer after the two healthy ones, show the failed call, and write the third copy to a stand-in with a hint, after the response.

**4. Read path.** Ask two replicas and return the newest version. For `"Stale replica"`, write the newer version back to the stale replica before answering.

**5. Size it.** Count replica operations (90k), choose the shards so a group with a node down stays well under 100% and inside 60 ms, and size the coordinators for 40k requests. Add up the bill: the shard count decides it.

**6. Wrap up.** Name what you did not draw: gossip for membership and failure detection, anti-entropy with Merkle trees, vector clocks and sibling merging, and how a new node joins the ring.

## Common mistakes

**Sizing for the healthy cluster only** (`wrong/too-few-shards`). Three shards run at 50%, which looks fine. When a node fails, the two left in its group run at 75% and Put's p99 passes 60 ms. It fails `survive any node failure`. Four shards keep the degraded group near 56%.

**Reading every replica** (`wrong/read-all-replicas`). R = 3 feels safer, but with W = 2 a read of two already overlaps every acknowledged write. Reading three adds 30k replica reads a second on the busiest path, and carrying them takes a fifth replica group: $10,500 a month against a $9,500 budget.

**Failing writes when a replica is down** (`wrong/wait-for-every-replica`). W = 3 makes every node a single point of failure for its keys: one restart and every write to them answers `503`. It fails *A write survives a replica that is down*.

**No read repair** (`wrong/no-read-repair`). The coordinator notices the older version, answers with the newer one, and leaves the stale replica stale, so the next quorum that includes it may again carry old data. It fails *A read repairs a stale replica*.

**A cache in front of the store** (`wrong/cache-in-front`). Cheap, since two shards then suffice, but cached values are outside every quorum: a write acknowledged by two replicas never reaches the cache. It fails *Reads come from the replicas, not a cache*.

**Others.** `hash(key) mod n` placement, which reshuffles everything on every resize; last write wins by wall clock, which silently drops concurrent writes; and forgetting the `x3` and `x2`, which hides two thirds of the load.

## In the interview

Lead with the trade: "No leader, so any replica takes a write and the store stays writable; the cost is that reads can be stale and concurrent writes conflict, and quorums and versioning are how we control both." Then draw the ring, write N = 3, W = 2, R = 2 and the inequality, and multiply out the replica load: 10k × 3 + 30k × 2 = 90k.

Likely follow-ups:

- *How does a node know who is alive?* Gossip: every second each node exchanges membership and heartbeat state with a random peer, and a failure detector marks nodes suspect.
- *How does a new node join?* It takes virtual nodes on the ring, and the previous owners stream those ranges to it while still serving them.
- *Two writes at once?* Vector clocks detect the concurrency; the store keeps both siblings, and the reader merges. Or use CRDT values that merge themselves.
- *Can you offer strong consistency?* Per key, with R + W > N and no sloppy quorum, you get a read of the latest acknowledged write, but not linearizability under concurrent writes. For compare-and-set, use a consensus protocol per key range (Cassandra's lightweight transactions use Paxos).
- *A whole data center goes down?* Place replicas across zones, and use local quorums per data center with asynchronous replication between them.

## Further reading

- [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf), DeCandia et al., SOSP 2007: the ring, preference lists, sloppy quorums, hinted handoff, vector clocks and Merkle-tree anti-entropy.
- [Cassandra documentation: Dynamo](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html): consistent hashing with virtual nodes, replication strategies, tunable consistency and how read repair and hints work in Cassandra.
- [System Design Primer: Consistency patterns and availability patterns](https://github.com/donnemartin/system-design-primer#consistency-patterns): weak, eventual and strong consistency, fail-over and replication.
- [Riak KV documentation: Replication properties](https://docs.riak.com/riak/kv/latest/developing/app-guide/replication-properties/index.html): N, R and W per request, and what each setting does under failure.
- *Designing Data-Intensive Applications* (Martin Kleppmann), chapter 5 "Replication", section "Leaderless Replication", and chapter 6 "Partitioning".
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Key-value Store".
