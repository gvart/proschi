## Questions

### How many Explore loads a second at peak?
- kind: good
- fact: 1k Explore loads a second

About **1k Explore loads a second** for the slice of traffic in this exercise. Meta has published only fleet-wide totals.

### How many candidates does each request rank, and how many does it show?
- kind: good
- fact: Each load ranks 500 candidates, narrowed to 150, then 50, then 25

Retrieval samples **500 candidates** per request. Three ranking passes narrow them to **150**, then **50**, then the **25** that fill the first page.

### What does one prediction of each model cost?
- kind: good
- fact: one heavy machine 5k items a second in about 40 ms

The distilled model scores **100k items a second** per machine, the lightweight network **25k**, and the deep network only **5k items a second** in about **40 ms**, at $200, $300 and $600 a machine a month.

### Can the request read features from the warehouse?
- kind: good
- fact: A request never queries the warehouse

No. A request never queries the warehouse: features and embeddings are computed offline and read from online stores. The warehouse answers in about half a second.

### How fast must the page load?
- kind: good
- fact: p99 of loading Explore under 300 ms, all three passes included

p99 under **300 ms**, retrieval and all three ranking passes included, and available **99.95%** of the time.

### Is there a budget?
- kind: good
- fact: At most $20,000 / month, the warehouse and the pipeline included

At most **$20,000 a month**, the warehouse and the pipeline included.

### Which model architecture should the final ranker use?
- kind: weak

Model architecture is an ML question, and the system design does not depend on it. Ask what one prediction costs and how many items each model must score.

### Should we use TensorFlow or PyTorch for serving?
- kind: weak

The framework does not change the load. Ask how many predictions a second each model must make.

### Can we show the same popular grid to everyone?
- kind: weak

That avoids the problem instead of solving it: the page must be personalized. Ask how many candidates each request ranks and how fast it must answer.

## Estimates

### How many machines would the deep model need to score every candidate, before headroom?
- answer: 100
- unit: machines
- range: 80 to 150

1k requests × 500 candidates = 500k items a second; ÷ 5k per machine = **100 machines**, about 140 near 70% busy. At $600 each that is far over the $20,000 budget.

### In the funnel, how many items a second does the deep model score?
- answer: 50000
- unit: items/s
- range: 40000 to 60000

1k requests × 50 survivors = **50k items a second**: 10 machines at 5k each, about 15 with headroom for a lost one.

### How many machines does the first pass need, before headroom?
- answer: 5
- unit: machines
- range: 4 to 8

1k × 500 = 500k items a second; ÷ 100k per machine = **5 machines**. Eight keep it near 63% busy and 71% after losing one.

Numbers: [Numbers to know](../docs/numbers/).
