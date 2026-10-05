---
type: estimate
difficulty: easy
related: [metrics-ingest]
answer: 2000000
unit: data points/s
---

## Question

100,000 hosts each report 200 metrics every 10 seconds. How many data points
per second does the ingestion tier receive?

## Solution

Per host: 200 ÷ 10 s = 20 points/s. × 100,000 hosts = **2,000,000 points/s**.
At that rate, pre-aggregating before storage cuts the write volume a lot.
