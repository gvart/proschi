---
type: flip
difficulty: medium
tags: [data-structures]
related: [snowflake-ids]
---

## Front

How does a Snowflake id fit time, worker and sequence into 64 bits?

## Back

1 unused sign bit, **41 bits of milliseconds** since a custom epoch (about 69
years), **10 bits of worker id** (1,024 generators) and a **12-bit sequence**
(4,096 ids per millisecond per worker). Ids sort roughly by time, and no
generator needs to ask another for anything.
