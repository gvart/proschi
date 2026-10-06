## Questions

### How many view events a second, and are all counted?
- kind: good
- fact: 20k view events per second at peak; about 10% are filtered out

**20k a second** at peak; about **10%** are filtered out.

### How many counter writes a second?
- kind: good
- fact: 2k counter writes per second

About 20k posts change in any 10 seconds: **2k counter writes a second**.

### How many count reads a second?
- kind: good
- fact: 10k count reads per second

**10k a second**.

### How fresh and exact must counts be?
- kind: good
- fact: a view is counted within seconds, and the count may be off by a few percent

Near real time: a view is counted within seconds, and the count may be off by a few percent.

### What does recording a view do before answering?
- kind: good
- fact: A view event is written durably (to Kafka) before the client hears back

It is written durably (to Kafka) before the client hears back, and does nothing else.

### What latency do we need?
- kind: good
- fact: p99 of Record view and of Read count under 60 ms

p99 of **Record view** and **Read count** under **60 ms**.

### Should counts show as 1.2K or 1,234?
- kind: weak

A display detail.

### Which dashboard should the analytics team use?
- kind: weak

Not part of this problem.

### Which language is the consumer written in?
- kind: weak

An implementation detail.

## Estimates

### How many views a second are counted?
- answer: 18k
- unit: views/s
- range: 16k to 20k

20k × 90% = **18,000 a second**.

### Batching gives 2k counter writes a second. How many times fewer writes than one per counted view?
- answer: 9
- unit: times
- range: 7 to 11

18k ÷ 2k = **9 times** fewer writes.

### How many views a day at an average of half the peak?
- answer: 864M
- unit: views
- range: 600M to 1.2B

10k × 86,400 ≈ **864 million a day**.

Numbers: [Numbers to know](../docs/numbers/).
