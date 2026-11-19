## Questions

### How fresh and exact must counts be?
- kind: good
- fact: a view is counted within seconds, and the count may be off by a few percent

Near real time: a view is counted within seconds, and the count may be off by a few percent.

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

A display detail that changes nothing behind the API. Ask how exact the count must be: "within a few percent" is what allows an approximate counter.

### Which dashboard should the analytics team use?
- kind: weak

Not part of this problem, which ends at the number next to the post. Ask how many views and count reads arrive each second.

### Which language is the consumer written in?
- kind: weak

An implementation detail: any language can read Kafka. Ask what recording a view must do before it answers, and how fast views arrive.

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

Half of the 20k peak is 10k a second: 10k × 86,400 ≈ **864 million a day**.

### A post has 10 million unique viewers. How much memory does an exact set of 8-byte user ids take?
- answer: 80
- unit: MB
- range: 60 to 100

10M × 8 bytes = **80 MB**, for one post. A HyperLogLog takes at most 12 KB whatever the count, thousands of times less, for an error under 1%.

Numbers: [Numbers to know](../docs/numbers/).
