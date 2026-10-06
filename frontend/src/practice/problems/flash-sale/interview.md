## Questions

### How many page views a second when the sale starts?
- kind: good
- fact: 80k page views a second

**80k page views a second**, 95% for pages the edge has cached.

### How many checkout attempts, and how many can checkout take?
- kind: good
- fact: Checkout can take about 500 a second

**10k attempts a second** (counting polls from the queue page), but checkout takes only about **500 a second**.

### What does the shop's database look like?
- kind: good
- fact: one MySQL shard, a primary and a replica

One pod: **one MySQL shard, a primary and a replica**. It cannot be split for the sale.

### How many writes can the primary manage during the sale?
- kind: good
- fact: about 2k writes a second for this sale

Every checkout takes a unit from the same few rows, so only **about 2k writes a second**.

### Can we keep the inventory count in Redis?
- kind: good
- fact: No eventually consistent store (a cache, Redis) is on the checkout path

No: the database decides both "never sold twice" and "every sale has its order". No eventually consistent store is on the checkout path.

### Where do the buyers who have to wait, wait?
- kind: good
- fact: Buyers who wait must not reach the app servers or the database at all

Somewhere cheap: buyers who wait must not reach the app servers or the database at all.

### What are the latency targets?
- kind: good
- fact: p99 of a product page under 50 ms, of a placed order under 150 ms

p99 of a product page under **50 ms**, of a placed order under **150 ms**.

### Should the page show a countdown animation?
- kind: weak

A front-end detail. Ask how many buyers arrive and what checkout can take.

### Can we buy a bigger database just for the day?
- kind: weak

The pod is fixed by the problem; ask what it can take and design admission around it.

### Which payment provider do we use?
- kind: weak

It does not change the bottleneck, which is the inventory rows.

## Estimates

### How many checkout attempts a second must wait instead of reaching checkout?
- answer: 9500
- unit: attempts/s
- range: 9000 to 10000

10k − 500 = **9,500 a second** must be held in a queue page served from the edge.

### How many product page views a second miss the edge cache?
- answer: 4000
- unit: views/s
- range: 3000 to 5000

80k × 5% = **4,000 a second** reach the app servers.

### At 350 orders a second, how many orders in the first ten minutes?
- answer: 210k
- unit: orders
- range: 150k to 250k

350 × 600 s = **210,000 orders**.

Numbers: [Numbers to know](../docs/numbers/).
