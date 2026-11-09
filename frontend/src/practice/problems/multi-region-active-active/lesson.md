# Multi-region active-active: two regions serving, either one enough

```tldr
Run every service on the member's path in **two regions at once**, and let DNS split members between them. Keep services stateless and data local: each region reads and writes its own database, which **replicates to the other asynchronously**, so no request ever waits on the other region. The price is **headroom**: when one region is evacuated, the other carries everyone, so each must be built for all the traffic, not its half.
```

## What you'll learn

- Why a company that already spreads every service over several Availability Zones also runs in a second region, and why **active-active** beats a standby region.
- How **geo-DNS** splits members between regions, and how overriding it moves them all to one region.
- Why multi-region needs **stateless services** and **local data**, and why replication between regions is **asynchronous**.
- How to keep a per-region cache from serving stale data when writes happen in the other region.
- How to size a region for the day the other one fails, and what that does to the bill.

## The problem, explained

In 2013 Netflix's internal availability goal was 99.99%: under an hour of downtime a year. Its services already ran on many instances across several Availability Zones (AZs), which protects against a machine or a data centre failing. It does not protect against what worried Netflix more: its own pace of change. A bad deploy, a broken configuration or an overloaded middle-tier service can take down a critical path in a whole region at once, every zone included.

So Netflix deployed every service on a member's call path in two AWS regions, **US-East-1** in Virginia and **US-West-2** in Oregon, both serving members all the time. On a normal day geo-DNS sends each member to the closer region, roughly half to each. When a region goes bad, Netflix overrides DNS and sends every member to the healthy one. Members see a short blip instead of an outage, and engineers can fix the broken region without the clock running.

In the problem, members **Browse** (8k requests a second) and **Save progress** (2k), half in each region. Each region has a Zuul gateway, a stateless playback API, EVCache in front of Cassandra, and nothing it shares with the other region except Cassandra's background replication. The third use case, **Browse in failover**, adds to each region the members it takes over when the other is evacuated. You size both regions so that the drill fits.

## Back-of-the-envelope

```numbers
99.99% | Netflix's availability goal: about **53 minutes a year**
50/50 | members per region on a normal day
9k / s | one region's API load when the other is evacuated
7 | API instances per region: 64% busy, 75% after losing one
~36% | the API's load on a normal day: the cost of standing by
$4,600 | a month for both regions
```

**A normal day.** Each region gets half: 4k Browse and 1k Save progress, 5k requests a second at its Zuul and its API.

**The drill.** When US-East is evacuated, US-West keeps its own 4k Browse and 1k writes and takes US-East's 4k Browse: 9k a second in the model (the real day also moves US-East's 1k writes, see the statement). At 2k per API instance that is 4.5 instances' worth of work. Seven run at 64%; losing one leaves six at 75%, and p99 stays under 100 ms. Six would run at 75%, but losing one leaves five at 90%, and the queues push p99 over the limit.

**Zuul.** 9k a second at 10k per instance: two would do on paper (45%), but losing one leaves one at 90%. Three run at 30%, 45% after losing one.

**Cassandra and EVCache.** Browse misses are 10% on a normal day, 30% for members just moved (assumed): about 1.6k reads a second per region, plus 1k local writes and 1k replicated from the other region. Two Cassandra nodes (20k each) are almost idle; they are there for availability, as are two EVCache nodes.

| Per region | Normal day | Other region evacuated | Capacity |
|---|---|---|---|
| Zuul | 5k / s | 9k / s | 3 × 10k |
| Playback API | 5k / s | 9k / s | 7 × 2k |
| Cassandra | ~2.4k / s | ~3.6k / s | 2 × 20k |

**Cost.** Per region: 3 Zuul ($300), 7 API ($700), 2 EVCache ($300), 2 Cassandra ($1,000): $2,300, and $4,600 for both. Active-active roughly doubles the compute you pay for: on a normal day each API runs at about a third of its capacity.

```quiz
multi-region-failover-headroom
```

## Concepts

### Active-active versus active-passive

**Active-passive** keeps a second region on standby: deployed, maybe even sized, but serving no members. It is simple for data, since only one region writes. But the standby is a part of the system nobody uses: its configuration drifts, its caches are empty, and the first real test of the failover is the outage itself. Failing over then means cold caches, instances that need warming and procedures that have not run in months.

**Active-active** runs both regions for real. Every deploy, every config change and every cache is exercised by live members every day, so a failover only moves members to a region that is already working. The price: both regions take writes, so data must replicate both ways, and each region needs room to carry everyone.

```callout takeaway
A standby you never use is a standby you cannot trust. Active-active makes the second region prove itself every day.
```

```quiz
active-active-vs-active-passive
```

### Steering members with DNS

A member's device finds the API by name, and DNS answers with an address in one region. Netflix used **directional** records (UltraDNS) to send each part of North America to a chosen region, rather than latency-based routing, which could shift traffic unpredictably. In front of the load balancers it kept a **Route53** layer of CNAMEs, whose API changes records quickly and reliably, and drove both through its own library, **Denominator**. Failing over is then one change: point a Route53 CNAME at the other region.

DNS has limits. Answers are cached for their TTL, so some devices keep using the old region for a while; and DNS sees the resolver's location, not the member's. Netflix's **Zuul** gateway handled the stragglers: a request that arrives in the wrong region is **mis-routed**, and Zuul can either proxy it to the right region or answer with a redirect. In failover mode, a region stops sending mis-routed requests away and serves them itself.

```quiz
geodns-limits
dns-ttl-tradeoff
```

### Stateless services, local data

For any region to serve any member, a service instance must hold nothing a member needs on the next request: no sessions in memory, no local files. All state lives in the data tier. And every resource a request touches must be **in the same region**: its own Cassandra, its own cache, its own queues and buckets. An application that published to one S3 bucket now publishes to one per region.

The rule is simple: **no cross-region call on a member's request**. A call to the other region adds a cross-country round trip, tens of milliseconds, and, worse, makes this region's requests fail when the other region does. A design whose services run in two regions on one region's database has one point of failure with extra latency.

```callout pitfall
Two regions of stateless services on one database is not multi-region. When the database's region fails, both regions fail.
```

### Asynchronous replication between regions

If each region has its own copy of the data, writes made in one must reach the other. Netflix chose Cassandra partly because it replicates between data centres natively, in every direction and asynchronously. A write is acknowledged when a quorum of replicas **in the local region** has it (`LOCAL_QUORUM`); the copy to the other region follows in the background.

Synchronous replication across regions would wait for the other region on every write, adding the round trip to every bookmark, and failing writes whenever the link between regions is cut. Netflix's **Split-brain** exercise cut exactly that link to show that each region kept serving while replication queued up.

Async has a price. A member who writes in one region and is moved to the other right away may not see the write yet. Netflix tested how big that window was: it wrote 1 million records in one region and read them in the other 500 ms later, under production load, and found all of them. And two writes to the same row in two regions can conflict; Cassandra keeps the one with the later timestamp.

```quiz
cross-region-async
sync-vs-async-replication
```

### Keeping each region's cache honest

Netflix reads must be fast, generally single-digit milliseconds, so **EVCache**, its Memcached client, sits in front of Cassandra, and some data lives only there. Each region has its own EVCache, filled by its own reads. Replicating Memcached between regions would mean building multi-master replication for a cache.

Netflix did something smaller: after every write, the EVCache client sends the other region a message (through SQS) to **invalidate** that key. The next read there misses, falls through to the local Cassandra and fills the cache with the new value. The cache stays a cache, and the database stays the only thing that replicates.

```quiz
multi-region-cache-invalidation
```

### Headroom: each region carries everyone

This is the decision that sizes the system. On a normal day each region serves half the members. On the day one is evacuated, the other serves all of them. A region sized for its half saturates at the moment the second region exists for.

With two regions, each needs room for **double** its normal load; in practice, a normal utilisation under half its capacity, minus a margin for losing an instance during the failover. With three regions, a failed region's load splits over two, so each may run at up to two thirds: more regions, less headroom each.

Members moved to a region are also **cold** for it: their rows are not in its EVCache. Expect more misses, and more Cassandra reads, while the cache warms. Netflix shifted traffic gradually in its drills so services could scale up and caches warm, and gave Zuul a maximum traffic level above which it sheds requests to protect services still scaling and a persistence layer behind cold caches.

```callout takeaway
Size each region for the failover, not for the normal day: in a two-region active-active design, every region must carry all the traffic.
```

```quiz
surviving-a-zone
cold-cache-restart
```

### Failing over, and proving it works

A failover plan that is never run is a hope. Netflix's Simian Army tested it at three sizes: **Chaos Gorilla** takes out a whole Availability Zone; **Split-brain** cuts the network between the regions; **Chaos Kong** evacuates a region. In its Chaos Kong exercise, Netflix moved most US traffic to US-West-2, enough to show that one region could carry all of Netflix's load there, kept it there for over 24 hours, then moved it back to 50/50.

It also worked for real before the drills were done: when a middle-tier system in one region stopped answering, Netflix moved members to the healthy region and service came back quickly.

## Designing it step by step

**1. Scope.** Ask what must survive (a whole region, not just a zone), the availability goal (99.99%), the traffic and how it splits between regions, and which data each request reads and writes. Agree that a write may reach the other region a moment later.

**2. Two regions.** Draw one region as a full stack: Zuul, the stateless playback API, EVCache, Cassandra. Draw the second as its mirror. In front of both, DNS, with the device asking it before it calls a gateway.

**3. Normal traffic.** In Browse, each region's scenarios touch only that region's nodes: gateway, API, cache, then Cassandra on a miss. In Save progress, write the local Cassandra before answering.

**4. Replication.** After the answer, Cassandra copies the write to the other region and the API sends the other region an invalidation for its cache. Both are `->>` steps: nothing waits for the other region.

**5. Failover.** In Browse in failover, each evacuated region's members go to the other region and touch nothing in their own. Then size: count each region's load with the other one's members added, keep each tier comfortable, and keep it comfortable after losing one more instance. Check the bill.

## Common mistakes

**Each region sized for its half** (`wrong/sized-for-half`). Four API instances per region carry a normal day at 62%. In the failover drill each region gets 9k requests a second against 8k of capacity, and saturates. Caught by **the p99 of Browse in failover** and **survive any node failure**.

**A standby region** (`wrong/standby-region`). DNS sends everyone to US-East; US-West only serves when US-East is evacuated. Nothing exercises the standby until it is needed, and its caches are empty when it is. Caught by **"Both regions serve live traffic"**.

**Waiting for the other region on every write** (`wrong/synchronous-replication`). Save progress answers only after the other region's Cassandra has the bookmark. Every write pays a cross-country round trip and fails when the link between regions does. Caught by **"Writes replicate to the other region asynchronously"**.

**One database for both regions** (`wrong/one-database`). Services in two regions, Cassandra in one. Every western miss and write crosses the country, and evacuating US-East sends members to a region that still depends on it. Caught by **"Both regions serve live traffic"** and **"Evacuated traffic stays out of the failed region"**.

Beyond the tests:

- Relying on DNS alone: cached answers keep some devices on the failed region for the TTL, so the gateway must handle mis-routed requests.
- Moving all traffic in one step onto cold instances and caches, instead of shifting gradually behind a gateway that sheds above a set level.
- Deploying a change to both regions at once, so one bad change takes both down. Netflix waited hours between regional deploys.

## In the interview

```callout interview Start from the failure you protect against
"Zones protect against hardware. Regions protect against our own changes. So both regions serve, and each can carry everyone." Then: DNS steering, stateless services, local data, async replication, and the headroom it costs.
```

Likely follow-ups:

- *What happens to a write made just before the failover?* It may not have reached the other region yet: async replication has a window. Netflix measured reads 500 ms later in the other region and found them; anything that cannot lose a write needs a different design for that data.
- *Two regions write the same row. What wins?* With Cassandra, the write with the later timestamp. Design data so most rows have a single writer (a member writes from one region at a time), or merge on read.
- *How long does a failover take?* The DNS change is quick; cached answers last their TTL, so the gateway handles stragglers. Netflix's next goal was to automate the decision and the shift.

## Further reading

- Ruslan Meshenberg, Naresh Gopalani and Luke Kosewski, [Active-Active for Multi-Regional Resiliency](https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b) (Netflix TechBlog, 2013) — the design this problem is based on.
- [Zuul](https://github.com/Netflix/zuul), [EVCache](https://github.com/Netflix/EVCache) and [Denominator](https://github.com/Netflix/denominator) — Netflix's open-source gateway, cache client and DNS library.
- [Apache Cassandra documentation](https://cassandra.apache.org/doc/latest/) — data centres, replication and consistency levels such as `LOCAL_QUORUM`.
- [The System Design Primer](https://github.com/donnemartin/system-design-primer) — availability patterns: fail-over, active-active and active-passive, replication.
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 5 "Replication" — multi-leader replication across data centres and handling write conflicts.
