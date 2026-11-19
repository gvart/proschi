## Questions

### What is the mix of sends and reads?
- kind: good
- fact: 5k sends, 15k ordinary reads and 40k reads of the busy channel per second

**5k sends**, **15k ordinary reads** and **40k reads of one busy channel** a second (assumptions for the exercise).

### Do many readers of one channel ask for the same messages at once?
- kind: good
- fact: about 1% of the busy channel's reads start a query of their own

Yes, and coalescing identical queries in flight means only about **1%** of the busy channel's reads start a query of their own.

### What can the database partition holding one channel take?
- kind: good
- fact: which take 10k reads a second each

A partition is read only by its **3 replicas**, which take **10k reads a second each**. The cluster is 72 nodes, sized for disk, not load.

### May the API servers query the database directly?
- kind: good
- fact: no connection from the API to the database

No: every query goes through the data services, with no connection from the API to the database.

### Can we put a cache in front of the messages?
- kind: good
- fact: No message cache

No message cache: messages are edited, deleted and reacted to constantly, and every write would have to invalidate it.

### What latency and availability do we need?
- kind: good
- fact: p99 of every use case under 60 ms

p99 of every use case under **60 ms**, available **99.99%** of the time.

### Is there a budget?
- kind: good
- fact: At most $42,000 / month, the 72 database nodes included

At most **$42,000 a month**, the 72 database nodes included.

### Which language are the data services written in?
- kind: weak

Rust or Go does not change the design. Ask what the hot partition can take.

### Should we replace ScyllaDB with something else?
- kind: weak

The store is given. Ask what it can do, then design around its limits.

### How many emoji reactions does a message allow?
- kind: weak

A product detail that does not change how reads reach the database.

## Estimates

### Without coalescing, each read of the busy channel asks 2 replicas (quorum). How many replicas would those reads need at 10k reads a second each?
- answer: 8
- unit: replicas
- range: 6 to 10

40k reads × 2 replicas = 80k replica reads a second. 80k ÷ 10k = **8 replicas**, but the partition has only 3: they would run at about 270%. Coalescing is not optional.

### After coalescing, how many queries a second does the busy channel cause?
- answer: 400
- unit: queries/s
- range: 300 to 500

40k × 1% = **400 queries a second**. At quorum that is 800 replica reads, under 3% of the 30k its 3 replicas take.

Numbers: [Numbers to know](../docs/numbers/).
