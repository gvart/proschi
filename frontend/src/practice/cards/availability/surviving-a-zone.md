---
type: choice
difficulty: medium
tags: [estimation]
related: [ride-matching]
---

## Question

Peak load needs 6 servers. They are spread evenly over 3 availability zones,
and the service must survive losing a whole zone. How many servers do you
run?

## Options

- [ ] 6
- [ ] 7
- [x] 9
- [ ] 18

## Why

After a zone fails, the 2 remaining zones must carry all 6 servers' worth of
load: 3 per zone. 3 zones × 3 = 9. In general, with Z zones you need
N × Z ÷ (Z − 1).
