---
type: flip
difficulty: medium
tags: [streaming]
related: [metrics-ingest]
---

## Front

Sensor readings are range-partitioned by timestamp. Why does one shard take
all the writes, and what is the fix?

## Back

All new readings have "now" as their key, so they land in the newest range,
on one shard. Put something else first: partition by **(sensor_id,
timestamp)** or prefix the key with a small hash bucket, so writes spread
while each sensor's readings stay ordered by time.
