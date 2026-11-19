## Questions

### How many ids a second?
- kind: good
- fact: 20k rps at peak

**20k a second** at peak; Twitter asked for at least 10k a second per process.

### How often do generators start?
- kind: good
- fact: about one a minute across the fleet

Rarely: **about one a minute** across the fleet.

### Can we use a shared counter?
- kind: good
- fact: No shared counter

No shared counter: making an id never calls a database, a cache or ZooKeeper.
A counter would be a round trip and a single shared dependency for every
tweet.

### When may generators coordinate?
- kind: good
- fact: Coordination happens once per process, at startup

Once per process, at startup. So whatever generators must agree on has to
be settled then, and every id after it is made in memory.

### What latency must an id meet?
- kind: good
- fact: p99 of Get ID under 40 ms

p99 of **Get ID** under **40 ms**: one hop to a generator fits easily, as
long as the generators are not run hot.

### What availability do we need?
- kind: good
- fact: Get ID available 99.99% of the time

**99.99%**, about four minutes of downtime a month: any generator must be
able to answer, and none may depend on a shared component per id.

### Is there a budget?
- kind: good
- fact: At most $4,000 / month, the existing ZooKeeper cluster and Tweet Service included

At most **$4,000 a month**, the existing ZooKeeper cluster and Tweet Service included. That
caps how many generators you can run.

### Should ids be UUID strings?
- kind: weak

The statement already says ids are 64-bit and roughly time-ordered; read it
before asking. Ask how many ids a second are needed instead.

### Which language should the generator be written in?
- kind: weak

An implementation detail. Ask whether making an id may call a shared store,
and how available it must be.

### Should ids look nice in URLs?
- kind: weak

Encoding is a presentation detail: the id is a 64-bit number whatever it
looks like. Ask when generators are allowed to coordinate.

## Estimates

### How many years do 41 bits of milliseconds last?
- answer: 69.7
- unit: years
- range: 60 to 80

2⁴¹ ≈ 2.2 × 10¹² ms. A year is 1,000 × 86,400 × 365 ≈ 3.15 × 10¹⁰ ms, so 41 bits last ≈ **69.7 years**, call it 70, from the chosen epoch.

### How many ids a millisecond can one worker make with a 12-bit sequence?
- answer: 4096
- unit: ids/ms
- range: 4000 to 4200

2¹² = **4,096** ids a millisecond, about 4 million a second: 200 times the 20k a second the whole fleet needs.

### With 10 bits of worker id, how many generators can run at once?
- answer: 1024
- unit: generators
- range: 1000 to 1100

2¹⁰ = **1,024**: each running generator needs its own worker id, and that
is the only thing they coordinate on.

Numbers: [Numbers to know](../docs/numbers/).
