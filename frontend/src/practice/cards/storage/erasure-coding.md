---
type: flip
difficulty: hard
tags: [availability]
---

## Front

Erasure coding versus 3× replication for durable storage: what do you trade?

## Back

3× replication costs **200% extra** space but reads are simple and repairs
copy one replica. Erasure coding (for example 6 data + 3 parity pieces) costs
about **50% extra** and still survives 3 lost pieces, but reads and repairs
need several nodes and CPU to rebuild. So hot data is often replicated and
cold data erasure-coded.
