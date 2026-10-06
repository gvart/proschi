## Questions

### How many seat map loads a second, and how many are cached?
- kind: good
- fact: 20k rps of seat map loads at the on-sale peak; 97% are served from a cache

**20k a second** at the on-sale peak; **97%** from a cache.

### How many hold attempts, and how many lose?
- kind: good
- fact: 6k rps of hold attempts, about 60% of them for seats someone else got first

**6k a second**, about **60%** for seats someone else got first; each one is a write.

### How many confirmations, and how do they end?
- kind: good
- fact: 500 rps of confirmations: 90% paid, 7% declined, 3% too late

**500 a second**: 90% paid, 7% declined, 3% too late.

### Who decides whether a seat can be held?
- kind: good
- fact: decided by one strongly consistent store, with a conditional write

One **strongly consistent** store, with a conditional write; never an eventually consistent one.

### In which order do payment and booking happen?
- kind: good
- fact: a seat is booked only after its payment was approved

A seat is booked only after its payment was approved, and a fan is never charged without a valid hold.

### How slow is the payment provider?
- kind: good
- fact: the payment provider takes about 250 ms

About **250 ms**; a confirmation has a p99 limit of **1.5 s**.

### Which colours should free and taken seats have?
- kind: weak

A UI detail.

### Should tickets be NFTs?
- kind: weak

Not a requirement.

### Which venue is it?
- kind: weak

The venue does not change the design.

## Estimates

### How many seat map loads a second miss the cache?
- answer: 600
- unit: loads/s
- range: 450 to 750

20k × 3% = **600 a second**.

### How many hold attempts a second lose to someone else?
- answer: 3600
- unit: holds/s
- range: 3000 to 4200

6k × 60% = **3,600 a second**, all decided by the store.

### How many bookings a second are written?
- answer: 450
- unit: bookings/s
- range: 400 to 500

500 × 90% paid = **450 a second**.

Numbers: [Numbers to know](../docs/numbers/).
