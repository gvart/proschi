## Questions

### How many suggestion requests a second?
- kind: good
- fact: Suggestions: 100k rps at peak

**100k a second** at peak; searches are **2k a second**.

### Are most prefixes popular?
- kind: good
- fact: 80% of them are for popular prefixes the CDN can cache

Yes: **80%** are for popular prefixes a CDN can cache.

### How much data is there?
- kind: good
- fact: About 5 million distinct prefixes with ten completions each

About **5 million** distinct prefixes with **ten** completions each: a few GB, small enough for memory.

### Can suggestions query the search cluster?
- kind: good
- fact: suggestions must never reach it, nor any database

No: the search cluster is sized for searches only; suggestions must never reach it, nor any database.

### How big is the search cluster?
- kind: good
- fact: The search cluster is sized for searches only (about 9k rps)

Sized for searches only, about **9k rps**.

### What latency do suggestions and searches need?
- kind: good
- fact: p99 of a suggestion under 50 ms; of a search under 300 ms

p99 of a suggestion under **50 ms**, of a search under **300 ms**.

### Should suggestions show images?
- kind: weak

A UI choice.

### Which keyboard layouts do we support?
- kind: weak

Client-side; it does not change the design.

### Which font should the dropdown use?
- kind: weak

A UI detail.

## Estimates

### How many suggestion requests a second get past the CDN?
- answer: 20k
- unit: requests/s
- range: 15k to 25k

100k × 20% = **20,000 a second** must be answered from memory.

### At 30 bytes per completion, how much memory do 5 million prefixes with ten completions take?
- answer: 1.5B
- unit: bytes
- range: 700M to 5B

5M × 10 × 30 bytes = **1.5 GB**: fits on one machine, replicate it.

Numbers: [Numbers to know](../docs/numbers/).
