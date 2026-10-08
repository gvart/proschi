# Replicated Git Storage: three copies, a quorum, and reads from any of them

```tldr
Replicate at the **Git level, not the disk**, so all three copies serve traffic and any one can die without a failover. A push succeeds on a **quorum of two of three**; a fetch reads **one** replica that a small **checksum table** says is current. Then size the file servers from the **fan-out**, with one server removed.
```

## What you'll learn

- The difference between replicating disks (active/standby) and replicating at the application level, and why the second lets every copy serve traffic.
- How a write quorum (two of three) keeps writes durable and available when one replica is down.
- How a small metadata table of checksums lets reads go to any up-to-date replica without reading them all.
- How fan-out multiplies load, and how to size a replicated store from it.

## The problem, explained

GitHub stores every repository as a Git repository on a file server. For years each file server had a hot standby, its disk mirrored block by block with DRBD (a Linux tool that replicates a block device over the network). The standby served nothing, a failover took the repository offline until it finished, and losing both servers of a pair took many repositories down.

DGit, later renamed **Spokes**, replicates at the Git level instead: each repository is three ordinary Git repositories on three file servers. A proxy sends every push to all three, runs a commit protocol, and acknowledges once at least two have applied it. A checksum per replica tells which copies are up to date, so a fetch can go to any of them.

Two use cases:

- **Push**: the developer gets `200` once the update is committed on at least two of three replicas. Scenarios: `"All replicas commit"` and `"One replica down"`, where the push still succeeds on the other two. The new checksums are recorded in `routes` before the developer hears back.
- **Fetch**: a developer fetches or clones. The proxy looks up which replicas are current, reads one, and returns a packfile (Git's compressed bundle of objects).

**Requirements.** p99 (the latency that 99% of requests beat) under 100 ms for Push and 75 ms for Fetch; 99.99% availability for both; durable pushes; survival of any single machine, a file server included; $6,800 a month, `routes` included.

**What is given.** `dev`, the developer client, and `routes`, a MySQL table (four replicas) of which servers hold each repository and each replica's checksum. Such metadata usually already lives in a company's main database; the design is about the file servers.

**What the tests check**: the node `fs` has at least three replicas, and only the proxy reaches `fs` or `routes`. A push writes `fs` and then `routes` before responding, handles the failure of `fs`, and still answers 2xx in the `"One replica down"` scenario. A fetch reads `routes` before `fs`.

The model simplifies: an `x3` write stands for three replicas each taking the update, a node's replicas share its load evenly, and replication lag, repair and "closest replica" choice are not modelled.

## Back-of-the-envelope

The traffic is one slice of the fleet: 1k pushes and 20k fetches per second, one push in a thousand finding a replica down. Spokes as a whole holds over 38 million repositories and 36 million gists, each stored at least three times: the fleet's disk is three times its data.

```numbers
21k rps | at the proxy
26k rps | on the file servers
6 | file-server calls per push
43% → 65% | one set of three, then with a server lost
$5,200 | left for proxy and file servers
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Requests at the proxy | 1k + 20k | 21k rps |
| Fetch reads on `fs` | 20k × 1 replica | 20k rps |
| Push prepares on `fs` | 1k × 3 replicas | 3k rps (reads) |
| Push commits on `fs` | 1k × 3 replicas | 3k rps (writes) |
| Total on `fs` | 20k + 3k + 3k | 26k rps |
| Same, if a fetch read all three | 60k + 6k | 66k rps |
| `routes` reads / writes | 20k lookups / 1k checksum updates | 25% / 20% |
| Proxy replicas at 100% | 21k ÷ 2k | 11 |

**Fetches dominate.** Twenty fetches for every push: anything that multiplies read cost (reading every replica, reading `routes` many times) multiplies the biggest number in the table.

**A push costs six calls**: a prepare and a commit to every replica. The simulation counts `PREPARE` as a read and `COMMIT` as a write (only write verbs such as INSERT, UPDATE, COMMIT count as writes).

**Sizing the file servers.** A generic NoSQL kind: 20k reads and 20k writes per replica, sharing the machine, so utilisation is the sum of both shares. One set of three takes 26k of 60k, about 43%.

```callout pitfall 43% looks fine until you remove a server
The same load on two servers is 65%. The push path visits `fs` twice, so it queues enough to cross 100 ms. Adding sets (shards of three) spreads repositories over more servers.
```

**Proxy.** At 2k rps per replica, 21k needs 11 replicas just to keep up; the p99 decides how many more.

**Cost.** `routes` costs $1,600 (4 × $400), a file server replica $500, a proxy replica $100. That leaves about $5,200 for proxy and file servers.

```deepdive The failure scenario, p99 and availability
**p99.** In `"One replica down"` the proxy's call to the dead server fails with `-x`, which the simulation charges as a 1,000 ms timeout. Only 0.1% of pushes take that path, so it sits beyond p99 and shows up at p99.9. That is realistic: a down replica costs a few slow pushes until the proxy marks it bad.

**Availability.** A push writes `routes`, a single-primary MySQL store. With replicas, failover keeps its writes available 99.995% of the time in the model. Three file server replicas make `fs` itself effectively always up.
```

## Concepts

### Disk replication versus application-level replication

**Block-level replication** (DRBD, RAID 1 across machines) copies bytes on disk without knowing what they mean. It is simple and works for any software, but the standby cannot serve traffic: its filesystem is not mounted while the primary writes to it. Failover means detecting the failure, promoting the standby, mounting and restarting services, with the data offline meanwhile.

**Application-level replication** copies meaningful operations. Git is ideal: a repository is immutable objects plus a few references (branch names pointing at commits), and Git already copies objects between repositories. If three servers each hold a full repository and agree on the references, all three serve reads, and any one can die without a failover.

**Trade-offs.** You build the replication logic (coordination, repair of a replica that fell behind, placement of replicas), and it only works for data whose semantics you control. Do not reach for it when an off-the-shelf replicated store (a database with built-in replication) already fits.

```quiz
disk-vs-app-replication
```

### Quorums

With N copies, a **write quorum** W means a write succeeds once W copies have it; a **read quorum** R means a read consults R copies. When `R + W > N`, every read overlaps at least one copy with the latest write. Dynamo-style stores use this rule directly.

Spokes uses `N = 3, W = 2`. A push succeeds on any two servers, so it survives one failure, and is never acknowledged on fewer than two, so one disk failure cannot lose it. Reads use `R = 1`, breaking the overlap rule (1 + 2 is not more than 3), but not blindly: the checksums in `routes` say which replicas have the latest state, and that lookup replaces the extra read.

To make the two-of-three commit atomic, the proxy runs a **commit protocol**: first ask every replica whether it can apply the update (a vote), then tell them to commit or roll back. GitHub describes it as a three-phase commit.

```callout takeaway
Never acknowledge a write before a quorum has durably applied it.
```

**When not to use quorums.** When one primary with synchronous standbys is simpler and good enough, or when you cannot afford the extra latency of a round of votes.

````deepdive A quorum write in Proschi
```proschi
title "Quorum write"

client "Client"   [Actor]
coord  "Coordinator" [Service] x2
store  "Replicas" [NoSQL Database] x3

client -> coord : HTTPS
coord  -> store : replicate

usecase "Write" {
  client -> coord : PUT /items/1
  alt "All up" {
    coord  -> store : x3 WRITE item 1
    store --> coord : 3 acks
  } alt "One down" {
    coord  -x store : WRITE item 1 on the failed replica
    coord  -> store : x2 WRITE item 1
    store --> coord : 2 acks, quorum
  }
  coord --> client : 200
}
```
````

```quiz
quorum-read-size
quorum-replica-load
```

### Version metadata for safe reads

Reading "any replica" is safe only if you know which are current: one may have missed a push while down, or still be catching up. Spokes keeps a checksum per replica over the repository's references; equal checksums mean equal state. The proxy records new checksums after every commit and asks which replicas match before every read.

The general pattern: a small, strongly consistent metadata store (here MySQL) guards a large replicated data store. It gives **read-your-writes** (you always see your own latest write): a developer who pushes then fetches is sent to a replica that has the push. The cost is one lookup per read, so it must be cheap and the metadata store well replicated.

```quiz
read-your-writes
```

## Designing it step by step

### 1. Scope the problem

Clarify: how many copies? (Three.) What does a push promise? (Durable on a quorum before `200`.) Is a stale read acceptable? (No: a fetch must see the latest pushed state.) The read:write ratio? (20:1.) Which failures must be tolerated? (Any single server, without interrupting pushes.)

### 2. High-level design

Developer → proxy → file servers, with the proxy also reading and writing `routes`. The proxy is the only thing that knows where repositories live; developers never address a file server.

Push: send the update to all three replicas, collect votes, commit, record checksums, answer. Fetch: ask `routes` which replicas are current, read one, answer.

Name the alternatives and why they lose:

| Alternative | Why it loses |
|---|---|
| The old active/standby pair | The standby does no work, and a failover stops pushes |
| Acknowledge after one replica, copy the rest asynchronously | Fast, but a push acknowledged by one server dies with it |
| Read all three and compare | Correct, but triples the dominant load |

### 3. Deep dive

**Write the failure scenario explicitly.** `"One replica down"` proves the quorum: one `-x` call to the dead server, the prepare and commit to the other two (`x2`), and still a `200`. Steps after the `alt` (the `routes` update, the response) apply to both branches.

**Size the file servers from the fan-out.** A fetch is one read, a push three prepares and three commits. Remove one server from a set of three and check the push p99. If it breaks 100 ms, add sets with `capacity { fs shards N }`, not replicas per set: the problem fixes three copies per repository.

**Size the proxy.** From 21k requests at 2k per replica, add headroom until the latency limits hold with one replica gone. Most of the budget after `routes` goes to file servers, so do not overprovision it.

**Budget check.** Replicas times shards times $500 for the file servers, plus proxy replicas at $100, plus $1,600 for `routes`.

### 4. Wrap-up

Summarise: three Git-level replicas per repository, a two-of-three commit, checksums so a fetch reads one current replica, and enough sets of three that losing a server does not hurt latency. Next: automatic repair of a stale replica, replicas across racks or data centers (GitHub's "Stretching Spokes"), and reads from the closest current replica.

## Common mistakes

**The active/standby pair** (`wrong/active-standby-pair.proschi`). GitHub's design before DGit: one active file server per repository with a DRBD standby that serves no reads; during a failover, pushes return `503`. It fails "Every repository lives on three file servers behind a proxy" (`fs` has one replica) and "A push commits on a quorum of replicas" (the down scenario does not succeed).

**Acknowledge after one replica** (`wrong/ack-after-one-replica.proschi`). A primary takes the push and answers; the other two copy it asynchronously. With the primary down, pushes fail until someone takes over, and a push it alone acknowledged is lost if it dies before copying. It fails "A push commits on a quorum of replicas".

**Read any replica blindly** (`wrong/read-any-replica-blindly.proschi`). Fetches go to the nearest replica without checking `routes`, and one that missed a push serves old references: a developer pushes, fetches, and does not see their own commit. It fails "A fetch reads one replica that is up to date", which checks that the fetch consults `routes` before `fs`.

**Read every replica and compare** (`wrong/read-every-replica.proschi`). Correct answers, tripled cost: an `x3` fetch turns 20k fetches into 60k reads. It passes with every server up but fails `survive any node failure`: a set that loses a server can no longer carry the tripled reads within the latency limits.

## In the interview

Lead with the insight, then draw the push with its quorum and the fetch with its metadata lookup, and do the fan-out arithmetic.

```callout interview Lead with the insight
"Git is already a replication protocol. If I keep three full repositories in sync at the Git level, every copy can serve reads and any one can fail without a failover."
```

Expected follow-ups:

- **What if two replicas are down?** No quorum, so the push fails rather than accept a write that exists on one server. Reads still work from the remaining current replica while new copies are made on other servers.
- **How does a replica that missed pushes catch up?** A repair process finds it by checksum and syncs it from a current one with Git's own fetch before marking it current.
- **Why not `R + W > N` with R = 2?** It doubles read load to get a guarantee the checksums already provide with one cheap lookup.
- **What if `routes` is down?** It is replicated (four replicas here) and on every request's path, so its availability bounds the system's. A proxy cache of recent checksums could serve reads during a short outage, risking a stale read.
- **How do you spread across data centers?** Replicas in different data centers, so a site loss leaves a quorum, and reads from the closest current replica ("Stretching Spokes").

## Further reading

- [Introducing DGit](https://github.blog/engineering/architecture-optimization/introducing-dgit/), GitHub blog, 2016: why GitHub moved from DRBD pairs to three Git-level replicas.
- [Building resilience in Spokes](https://github.blog/engineering/infrastructure/building-resilience-in-spokes/), GitHub blog: the three-phase commit, the two-replica minimum and the checksums that track which replicas are in sync.
- [Stretching Spokes](https://github.blog/engineering/infrastructure/stretching-spokes/), GitHub blog, 2017: Spokes across data centers, quorum votes and reads from the closest in-sync replica.
- [System Design Primer: Replication](https://github.com/donnemartin/system-design-primer#replication): master-slave and master-master replication as availability patterns.
- [System Design Primer: Consistency patterns](https://github.com/donnemartin/system-design-primer#consistency-patterns): weak, eventual and strong consistency, the vocabulary for "may a fetch be stale?".
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): "Distributed Repositories, Dependencies, and Configurations Management" lists the DGit post among related designs.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): "Design A Key-value Store", which covers replication, quorum consensus and handling failures.
