## Questions

### How many tweets a second?
- kind: good
- fact: 20k tweets per second at a busy peak

**20k a second** at a busy peak.

### How many counters does a tweet update?
- kind: good
- fact: Each tweet updates about a dozen counters

About **a dozen**: four terms, each in three locations.

### How many locations, and how often are trends published?
- kind: good
- fact: About 1,000 locations, each published every 5 seconds

About **1,000 locations**, each published every **5 seconds**.

### How many trend reads a second?
- kind: good
- fact: 30k trends reads per second; 99% find the list in the cache

**30k a second**; **99%** find the list in the cache.

### Can the counting use a database or a cache?
- kind: good
- fact: counting a tweet calls no cache and no database

No: the detector keeps its windows in memory; counting calls no cache and no database.

### Does posting a tweet wait for counting?
- kind: good
- fact: Posting a tweet never waits for counting

Never: the tweet is stored, the firehose gets it asynchronously.

### What latency do posts and trend reads need?
- kind: good
- fact: p99 of Post tweet under 80 ms, of Get trends under 50 ms

p99 of **Post tweet** under **80 ms**, of **Get trends** under **50 ms**.

### Do emoji count as topics?
- kind: weak

A tokenizer detail.

### Should trends be personalised with machine learning?
- kind: weak

A different product; settle the counting pipeline first.

### Which language is the detector written in?
- kind: weak

An implementation detail.

## Estimates

### How many counter updates a second?
- answer: 240k
- unit: updates/s
- range: 200k to 300k

20k × 12 = **240,000 a second**: in memory, not in a database.

### How many trend publishes a second?
- answer: 200
- unit: publishes/s
- range: 180 to 220

1,000 ÷ 5 s = **200 a second**.

### How many trend reads a second miss the cache?
- answer: 300
- unit: reads/s
- range: 250 to 350

30k × 1% = **300 a second**.

Numbers: [Numbers to know](../docs/numbers/).
