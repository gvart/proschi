## Questions

### How many requests a second at peak, and how many does the edge answer?
- kind: good
- fact: 50k requests per second for the site at peak; 90% are edge hits

**50k requests a second** at peak; **90%** are edge hits, so 10% (5k a second) miss the edge.

### Can a second tier of caches catch some of the edge misses?
- kind: good
- fact: the upper tier answers 60%

Yes: of the edge misses, an upper tier answers **60%**. That leaves **4%** of all requests for the origin.

### What can the origin take, and can we add servers to it?
- kind: good
- fact: The origin has 4 servers that take 1k requests per second each

The origin is **4 servers** of **1k requests a second** each, answering in **50 ms**, and you cannot add more.

### Which components may talk to the origin?
- kind: good
- fact: Only the upper tier talks to the origin

Only the upper tier: no connection from the edge or the visitor, so the origin can allow just the upper tier's addresses.

### What latency and availability must asset fetches meet?
- kind: good
- fact: p99 of Fetch asset under 150 ms, available 99.99% of the time

p99 of **Fetch asset** under **150 ms**, available **99.99%** of the time.

### Which failures must the design survive?
- kind: good
- fact: an upper-tier data center included

Losing any single machine, **an upper-tier data center included**, must not break a latency limit or overload the origin.

### How often is content purged?
- kind: good
- fact: About 50 purges per second

About **50 purges a second**, each reaching some **300** edge data centers.

### Which CDN vendor should we use?
- kind: weak

The vendor is a procurement choice. Ask how much traffic misses the edge and what the origin can take: those decide the tiers.

### Which image formats will the site serve?
- kind: weak

Formats change the bytes, not the architecture. The hit ratios and the origin's limit are what matter here.

### Should the edge speak HTTP/3?
- kind: weak

A protocol detail that does not change where caches go or how much reaches the origin.

## Estimates

### How many requests a second reach the origin?
- answer: 2000
- unit: requests/s
- range: 1500 to 2500

10% miss the edge, and the upper tier answers 60% of those: 50k × 10% × 40% = **2,000 a second**, half of what the 4 origin servers take (and two thirds once one of them is down).

### How many requests a second reach the upper tier?
- answer: 5000
- unit: requests/s
- range: 4000 to 6000

Every edge miss: 50k × 10% = **5,000 a second**.

### How many purge messages a second do the edge data centers receive in total?
- answer: 15000
- unit: messages/s
- range: 10k to 20k

50 purges × 300 data centers = **15,000 a second**: purges fan out too, so they need their own path.

Numbers: [Numbers to know](../docs/numbers/).
