---
type: choice
difficulty: medium
tags: [networking, storage]
distinct-from: [round-trip-latencies]
---

## Question

Which of these takes the longest?

## Options

- [ ] 10,000 reads from main memory
- [ ] Reading 1 MB sequentially from an SSD
- [ ] One disk seek on a spinning hard drive
- [x] One network round trip from California to Europe

## Why

Approximate costs: 10,000 memory reads ≈ 1 ms, 1 MB from an SSD ≈ 1 ms or
less, a hard-drive seek ≈ 10 ms, a transatlantic round trip ≈ 150 ms. Distance
is bounded by the speed of light in fibre, so no hardware upgrade fixes it.
