## Questions

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

### What latency do pushes and fetches need?
- kind: good
- fact: p99 of Push under 100 ms, of Fetch under 75 ms

p99 of **Push** under **100 ms**, of **Fetch** under **75 ms**; both available **99.99%**.

### How often is a replica down during a push?
- kind: good
- fact: One push in a thousand finds a replica down

**One push in a thousand** finds a replica down.

### Who may talk to the file servers?
- kind: good
- fact: Nothing but the proxy talks to the file servers or to routes

Only the proxy, both to the file servers and to the `routes` lookup.

### How many repositories are stored?
- kind: good
- fact: over 38 million repositories and 36 million gists

Spokes holds **over 38 million repositories and 36 million gists**.

### Should we rewrite Git for the servers?
- kind: weak

Git is a given; the question is where its copies live and who talks to them.

### Do we support Mercurial too?
- kind: weak

Scope creep that changes nothing in the replication design. Ask how many copies a repository needs and what a push must guarantee.

### Which code review UI do we show?
- kind: weak

A product question far from the storage layer this problem is about. Ask about the push and fetch rates and which failures must be survived.

## Estimates

### How many calls a second do 1k pushes put on the file servers?
- answer: 6000
- unit: calls/s
- range: 5000 to 7000

Each push is applied on three servers, and each of them gets a prepare and a commit: 1k × 3 × 2 = **6,000 calls a second**.

### How many calls a second reach the file servers in total, if a fetch reads one replica?
- answer: 26k
- unit: calls/s
- range: 22k to 30k

20k fetches × 1 replica + 6k calls from pushes = **26k a second**. Reading all three replicas on every fetch would make it 66k: fetches are the number not to multiply.

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
