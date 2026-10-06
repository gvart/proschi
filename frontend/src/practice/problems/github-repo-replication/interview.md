## Questions

### How many repositories are stored?
- kind: good
- fact: over 38 million repositories and 36 million gists

Spokes holds **over 38 million repositories and 36 million gists**.

### How many pushes and fetches a second?
- kind: good
- fact: 1k pushes and 20k fetches per second at peak

In this slice, **1k pushes and 20k fetches a second** at peak: mostly reads.

### How many copies of each repository do we keep?
- kind: good
- fact: Every repository on three file servers

Every repository on **three** file servers; more sets of three are more shards.

### When is a push durable?
- kind: good
- fact: A push is durable on a quorum before the developer hears back

On a quorum before the developer hears back, and it still succeeds with one of its three servers down.

### Who may talk to the file servers?
- kind: good
- fact: Nothing but the proxy talks to the file servers or to routes

Only the proxy, both to the file servers and to the `routes` lookup.

### What latency do pushes and fetches need?
- kind: good
- fact: p99 of Push under 100 ms, of Fetch under 75 ms

p99 of **Push** under **100 ms**, of **Fetch** under **75 ms**; both available **99.99%**.

### How often is a replica down during a push?
- kind: good
- fact: One push in a thousand finds a replica down

**One push in a thousand** finds a replica down.

### Should we rewrite Git for the servers?
- kind: weak

Git is a given; the question is where its copies live and who talks to them.

### Do we support Mercurial too?
- kind: weak

Scope creep that changes nothing in the replication design.

### Which code review UI do we show?
- kind: weak

A product question far from the storage layer this problem is about.

## Estimates

### How many replica writes a second do 1k pushes cause?
- answer: 3000
- unit: writes/s
- range: 2500 to 3500

Each push goes to three servers: 1k × 3 = **3,000 writes a second**.

### How many pushes a second find a replica down?
- answer: 1
- unit: pushes/s
- range: 0.5 to 2

1k × 0.1% = **about one a second**: rare per push, constant for the fleet.

### At 100 MB per repository on disk, how much do 38 million repositories take with three copies?
- answer: 11.4
- unit: PB
- range: 6 to 20

38M × 100 MB = 3.8 PB, × 3 copies ≈ **11.4 PB**.

Numbers: [Numbers to know](../docs/numbers/).
