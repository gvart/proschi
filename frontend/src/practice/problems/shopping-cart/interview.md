## Questions

### How many adds and views a second?
- kind: good
- fact: 500 adds and 1k cart views per second at peak

**500 adds** and **1k cart views** a second at peak.

### How often do concurrent writes leave several versions?
- kind: good
- fact: 99.94% of reads saw exactly one version

Rarely: **99.94%** of reads saw exactly one version in Amazon's measurement.

### Which latency percentile matters?
- kind: good
- fact: The 99.9th percentile of both use cases under 300 ms

The **99.9th** percentile of both use cases under **300 ms**.

### What availability do adds need?
- kind: good
- fact: Add to cart available 99.999% of the time

**99.999%**: adds are never rejected because a primary is failing over.

### Must reads see the latest write?
- kind: good
- fact: Carts live in an eventually consistent store

No: carts live in an eventually consistent store, since a strongly consistent one refuses writes it cannot coordinate.

### When is an add durable?
- kind: good
- fact: An add is durable once the shopper hears 200

Once the shopper hears `200`.

### Do we show recommendations in the cart?
- kind: weak

A product feature, not the cart's storage design.

### Which currency do prices show in?
- kind: weak

A display detail.

### Should the cart icon animate?
- kind: weak

A UI detail.

## Estimates

### How many minutes of downtime a year does 99.999% allow?
- answer: 5.3
- unit: minutes
- range: 4 to 7

0.001% of 525,600 minutes ≈ **5.3 minutes a year**.

### How many cart views a second see divergent versions?
- answer: 0.6
- unit: views/s
- range: 0.4 to 0.8

1k × 0.06% = **0.6 a second**: rare, but each must be merged.

### At 2 KB per cart, how much storage do 100 million carts take with three replicas?
- answer: 600
- unit: GB
- range: 400 to 900

100M × 2 KB = 200 GB, × 3 = **600 GB**.

Numbers: [Numbers to know](../docs/numbers/).
