# Numbers to know

A one-page cheat sheet of the round numbers a system design interview runs
on: how long things take, how much one machine does, how big things are and
what they cost. None of them is exact, and none needs to be. What matters is
the order of magnitude: whether a number is a thousand or a million decides
whether one machine is enough or you need fifty. Every number below is
rounded, so read each one as "about".

Where Proschi's simulation has a default of its own, the section says how it
relates; [How the simulation works](https://proschi.app/docs/model/#profiles)
lists every default. To see the numbers used in a whole interview, read
[How to approach a system design interview](https://proschi.app/practice/approach/),
and to drill them, the estimate cards in
[daily review](https://proschi.app/practice/#/review/estimation).

## Latency

How long one operation takes. These are typical figures for current server
hardware and cloud networks; the classic table they come from is
[Latency numbers every programmer should know](https://gist.github.com/jboner/2841832).

| Operation | About |
|---|---:|
| L1 cache reference | 1 ns |
| L2 cache reference | 4 ns |
| Main memory (RAM) reference | 100 ns |
| SSD random read (NVMe) | 100 µs |
| Read 1 MB sequentially from an SSD | 0.3–1 ms |
| HDD seek (random read) | 10 ms |
| Read 1 MB sequentially from an HDD | 5–10 ms |
| Round trip within one data center (one zone) | 0.5 ms |
| Round trip between zones of one region | 1 ms |
| Read from an in-memory cache over the network | 0.5–1 ms |
| Simple indexed database query | 1–5 ms |
| Round trip between regions on one continent | 10–70 ms (US east to west: 60–70 ms) |
| Round trip between continents | 100–150 ms (to the far side of the world: 250–300 ms) |
| TLS 1.3 handshake | 1 extra round trip (TLS 1.2: 2), plus the TCP handshake's 1 |

How to use it:

- **Memory is about 1,000 times faster than an SSD read, and an SSD read is
  about 100 times faster than an HDD seek.** That is why hot data lives in a
  cache and why random reads from spinning disks are avoided.
- **Light in fiber covers about 200 km per millisecond**, so each 100 km of
  distance adds about 1 ms to a round trip. No hardware fixes that: a request
  that crosses an ocean pays 100 ms or more however fast the servers are.
- **A new connection costs round trips before the first byte.** TCP plus
  TLS 1.3 plus the request is 3 round trips: 450 ms for a user 150 ms away.
  Keep connections open and terminate TLS at an edge near the user.

Proschi's defaults sit in the same range: 1 ms for a cache, 5 ms for a
database, 10 ms for a service, 30 ms for object storage and 200 ms for a
third-party API, per call when the node is idle; queueing adds more as it
gets busy.

## Throughput and capacity

How much one machine or one partition does. **These are order-of-magnitude
rules of thumb, not benchmarks**: real numbers vary several-fold with the
hardware, the request size, the query and the configuration. Use them to
decide between one, ten and a hundred machines, then measure.

### Servers and data stores

| Component | About, per node |
|---|---:|
| Web or API server, simple requests | 1,000–10,000 requests/s |
| Redis (or Memcached) node, simple gets and sets | 100,000 ops/s (up to about 1 million with pipelining) |
| PostgreSQL primary, simple indexed reads | 10,000–50,000 queries/s |
| PostgreSQL primary, small writes | 1,000–10,000 writes/s |
| Kafka partition | 10 MB/s as a planning figure (tens of MB/s possible) |
| Kafka broker | 100s of MB/s, bounded by its disks and network |

Divide the peak load by what one node does, keep each node well below full
(50–70% busy, because latency climbs steeply near 100%), and add a node or
two so that losing one still leaves enough. Reads scale by adding replicas;
writes to a single-primary database do not, which is when you shard.

Proschi's per-replica defaults are inside these ranges: a service 2,000
requests/s, a cache 100,000, a relational database 20,000 reads and 5,000
writes per shard, a queue 50,000 messages/s
([all defaults](https://proschi.app/docs/model/#profiles)).

### Disks and networks

| Device or link | Sequential throughput | Random reads |
|---|---:|---:|
| HDD | 100–250 MB/s | 100–200 IOPS |
| SATA SSD | 500 MB/s | 50,000–100,000 IOPS |
| NVMe SSD | 3–7 GB/s | 500,000–1,000,000 IOPS |
| Cloud block volume (AWS gp3 baseline) | 125 MiB/s | 3,000 IOPS |
| 1 Gbit/s network | 125 MB/s | |
| 10 Gbit/s network | 1.25 GB/s | |
| 25–100 Gbit/s network (current servers) | 3–12.5 GB/s | |

Networks are measured in **bits** per second and files in **bytes**: divide
Gbit/s by 8 to get GB/s. A cloud VM's network is usually "up to" a figure,
from about 1 to 25 Gbit/s by instance size, and a cloud volume's speed is
what you provision, not what the disk underneath could do.

Proschi gives each replica a bandwidth: 200 MB/s for a service (about
1.6 Gbit/s), 1,000 MB/s for load balancers, gateways and CDNs, and 100 MB/s
for everything else.

### Connections

| Limit | About |
|---|---:|
| Open connections one server can hold (mostly idle, e.g. WebSockets) | 10,000s comfortably; 1 million with tuning |
| Default open-file limit of a Linux process | 1,024 (raise it for servers) |
| Outgoing connections from one IP to one destination IP and port | about 28,000 (Linux's default ephemeral port range) |
| PostgreSQL's default `max_connections` | 100; a few hundred is practical |

A connection held open costs memory, not CPU, so long-lived connections
(chat, push, WebSockets) are sized by memory: plan on tens of thousands per
server. A database connection is expensive (in PostgreSQL, a process each),
so services share a small pool, and a pooler such as PgBouncer sits in front
when there are many services. By Little's law, the connections in use =
requests per second × seconds each holds one.

## Time and conversions

### Seconds in a day, month and year

| Period | Exactly | Round to |
|---|---:|---:|
| Day | 86,400 s | 100,000 (10⁵) |
| Month (30 days) | 2,592,000 s | 2.5 million |
| Year (365 days) | 31,536,000 s | 30 million (π × 10⁷ is closer) |

### Powers of two and ten

| Power of two | Exactly | Power of ten | Name |
|---|---:|---:|---|
| 2¹⁰ | 1,024 | 10³ | thousand: KB (KiB = 1,024 bytes) |
| 2²⁰ | 1,048,576 | 10⁶ | million: MB (MiB) |
| 2³⁰ | 1,073,741,824 | 10⁹ | billion: GB (GiB) |
| 2⁴⁰ | about 1.1 × 10¹² | 10¹² | trillion: TB (TiB) |
| 2⁵⁰ | about 1.13 × 10¹⁵ | 10¹⁵ | quadrillion: PB (PiB) |

KB, MB, GB, TB and PB are powers of ten (a GB is 10⁹ bytes); KiB, MiB, GiB,
TiB and PiB are powers of two. The gap grows with the size: a GiB is 7% more
than a GB, a TiB 10% more than a TB, a PiB 13% more than a PB. For estimates,
treat them as equal; for a disk you are buying or a bill, check which one is
meant (operating systems and some cloud prices use GiB). A byte is 8 bits,
and 2³² is about 4.3 billion, the number of 32-bit values.

### Per day to per second

| Per day | Per second (average) |
|---|---:|
| 1 million | 12 |
| 10 million | 120 |
| 100 million | 1,200 |
| 1 billion | 12,000 |

Divide a daily count by 100,000 for a quick answer (about 14% low, which
rounding forgives), and a monthly count by 2.5 million. Then size for the
peak, not the average: peaks are usually 2–5 times the average, and say
which multiple you chose.

### Availability nines

| Availability | Downtime per day | Per month (30 days) | Per year |
|---|---:|---:|---:|
| 99% | 14.4 minutes | 7.2 hours | 3.65 days |
| 99.5% | 7.2 minutes | 3.6 hours | 1.8 days |
| 99.9% | 1.4 minutes | 43 minutes | 8.8 hours |
| 99.95% | 43 seconds | 22 minutes | 4.4 hours |
| 99.99% | 8.6 seconds | 4.3 minutes | 53 minutes |
| 99.999% | 0.9 seconds | 26 seconds | 5.3 minutes |

Each extra nine divides the downtime by ten. Components a request needs in a
chain multiply their availabilities (three at 99.9% give about 99.7%);
independent replicas multiply their downtime (two at 99% give 99.99%).
Proschi computes a use case's availability the same way, from each node's
per-replica availability.

## Sizes

| Object | About |
|---|---:|
| A character: ASCII / UTF-8 | 1 byte / 1–4 bytes |
| An integer: 32-bit / 64-bit (`int`, `bigint`) | 4 / 8 bytes |
| A timestamp (64-bit, e.g. Unix milliseconds) | 8 bytes |
| A UUID: binary / as text | 16 / 36 bytes |
| A tweet or short text post: text / with metadata | 300 bytes / 1 KB |
| A database row of a typical entity | 100 bytes–1 KB |
| A log line | 100–500 bytes |
| An image: thumbnail / web-sized photo / phone camera original | 10–50 KB / 100–500 KB / 2–5 MB |
| An average web page, all resources (HTTP Archive median) | 2–3 MB |
| A minute of audio at 128 kbit/s | 1 MB |
| A minute of 480p video at 1 Mbit/s | 7.5 MB |
| A minute of 720p video at 3 Mbit/s | 22.5 MB |
| A minute of 1080p video at 5 Mbit/s | 37.5 MB (an hour: 2.25 GB) |
| A minute of 4K video at 20 Mbit/s | 150 MB |

A minute of anything streamed is its bitrate × 60 ÷ 8: Mbit/s × 7.5 = MB per
minute. Storage then multiplies out: items per day × bytes per item × days
kept × replicas. A billion items of 1 KB is a terabyte; video services store
several resolutions of every video.

## Cloud costs

**Approximate public list prices of the big cloud providers in US regions,
rounded; they change, and they differ by provider, region, volume and
contract. Check the provider's pricing page before you rely on one.** They
are here for orders of magnitude: which part of a design dominates the bill.

| Item | About |
|---|---:|
| Block storage (an SSD volume, e.g. AWS gp3) | $0.08–0.10 per GB-month |
| Object storage, standard (S3, GCS, Azure Blob) | $0.02 per GB-month ($20–25 per TB-month) |
| Object storage, infrequent access | $0.01 per GB-month |
| Cold archive storage (e.g. S3 Glacier Deep Archive) | $0.001–0.004 per GB-month ($1–4 per TB-month) |
| Data out to the internet (egress) | $0.05–0.09 per GB, cheaper at high volume |
| CDN delivery | $0.01–0.08 per GB, by volume and contract |
| Data between zones or regions | $0.01–0.02 per GB |
| Data into the cloud (ingress) | free |
| A small VM (2 vCPUs, 4–8 GB of memory), on demand | $30–70 a month |

A month has about 730 hours, so a VM at $0.10 an hour is about $70 a month.
Two patterns show up in almost every design: **sending data costs more than
storing it** (a GB sent out once costs about as much as keeping it in object
storage for a few months), and **cold tiers are an order of magnitude
cheaper** for data that is rarely read, at the price of slower and
pay-per-read retrieval.

Proschi charges a flat monthly price per replica (a service $100, a cache
$150, a relational database $400, object storage $50) plus egress at
$0.09/GB from a node you run and $0.02/GB from a CDN. Those are teaching
values that keep designs comparable, not a quote.

## How to estimate

A back-of-the-envelope estimate goes the same way every time. Say each
assumption out loud and round at every step.

1. **Load:** users × actions per user per day ÷ 86,400 = average requests
   per second, separately for reads and writes.
2. **Peak:** multiply the average by 2–5.
3. **Storage:** new items per day × bytes per item × days kept × replicas.
4. **Bandwidth:** requests per second × bytes per response, × 8 for bits.
5. **Servers:** peak ÷ (what one node does × the share you will run it at),
   plus one or two spares; repeat for each tier.

### Worked example: a photo-sharing app

Assume 10 million daily active users, each viewing 20 photos a day; 1 in 10
users uploads one photo a day; a served photo is 100 KB, and the original
plus its resized copies take 2 MB in storage.

- **Load.** Views: 10M × 20 = 200M a day ÷ 86,400 ≈ 2,300 reads/s. Uploads:
  1M a day ÷ 86,400 ≈ 12 writes/s. Reads outnumber writes 200 to 1.
- **Peak.** At 3× the average: about 7,000 reads/s and 35 writes/s.
- **Storage.** Photos: 1M × 2 MB = 2 TB a day, about 730 TB a year, in
  object storage (which replicates for you). At $0.02 per GB-month, a year's
  photos cost about $15,000 a month to keep. Metadata: 1M rows × 1 KB = 1 GB
  a day, under 0.5 TB a year: one database primary holds it.
- **Bandwidth.** Average: 2,300 × 100 KB = 230 MB/s, about 1.8 Gbit/s;
  peak 700 MB/s, about 5.6 Gbit/s. A month is 230 MB/s × 2.6 million s ≈
  600 TB sent: about $12,000 through a CDN at $0.02/GB, several times that as
  plain egress. Serve photos from a CDN.
- **Servers.** API: 7,000 ÷ (2,000 × 60%) ≈ 6 servers, 7 or 8 with a spare.
  Cache: 7,000 reads/s is a small fraction of one Redis node; run 2 for
  availability. Database: with a 90% cache hit rate, 700 reads/s and
  35 writes/s, well within one primary with a replica.

The conclusion is the useful part: the bill and the bottleneck are photo
bytes (storage and delivery), not requests, so the design's effort goes into
object storage, a CDN and cheaper storage tiers for old photos. The request
path is small enough for a handful of servers.

To check estimates like these in a design, set `traffic` on a Proschi use
case and let the simulation divide it over the components; to practise them,
try the estimate cards ([how they are written](CARDS.md#estimate)).
