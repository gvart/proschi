---
type: cloze
difficulty: easy
---

## Text

For every service, the RED method tracks the {{rate|request rate|requests|throughput}}
of requests, the {{errors|error rate|failures|failed requests|failure rate}} and their
{{duration|latency|latencies|response time}}. For resources like CPUs, disks and pools, the USE method
tracks utilization, saturation and errors.

## Why

RED describes what users feel; USE explains why: a disk at 100% utilization
with a growing queue (saturation) is the cause behind rising durations. The
two together cover most dashboards.
