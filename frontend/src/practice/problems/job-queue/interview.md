## Questions

### How many jobs on the busiest days?
- kind: good
- fact: 1.4 billion jobs on the busiest days, at a peak of 33k jobs per second

**1.4 billion jobs** on the busiest days, at a peak of **33k a second**.

### Can enqueueing write to Redis?
- kind: good
- fact: An enqueue never touches Redis

No: an enqueue never touches Redis, and the web app has no connection to it.

### Can the web app write to Kafka itself?
- kind: good
- fact: The web app never talks to Kafka directly

No, the web app never talks to Kafka directly.

### When is a job accepted?
- kind: good
- fact: The job is written to Kafka before the web app hears back

Once it is written to Kafka, before the web app hears back.

### What latency and availability does enqueueing need?
- kind: good
- fact: p99 of Enqueue under 50 ms

p99 of **Enqueue** under **50 ms**, available **99.99%** of the time.

### How often can Redis not take a job?
- kind: good
- fact: About 0.1% of relays find Redis unable to take the job

About **0.1%** of relays find Redis unable to take the job.

### Is there a budget?
- kind: good
- fact: At most $8,000 / month, the web app and the workers included

At most **$8,000 a month**, the web app and the workers included.

### Which language are the jobs written in?
- kind: weak

It does not change how jobs are accepted and handed over.

### Could cron run the jobs instead?
- kind: weak

Cron schedules work; it does not take 33k jobs a second durably.

### What should the queue dashboard show?
- kind: weak

Monitoring matters, but first settle the rates and guarantees.

## Estimates

### What is the average rate on a busiest day of 1.4 billion jobs?
- answer: 16k
- unit: jobs/s
- range: 12k to 20k

1.4B ÷ 86,400 s ≈ **16,000 a second**; the peak is about twice that.

### At the peak, how many relays a second find Redis unable to take the job?
- answer: 33
- unit: relays/s
- range: 25 to 45

33k × 0.1% = **33 a second** need a retry path.

### At 1 KB per job, how much does Kafka take in on a busiest day?
- answer: 1.4T
- unit: bytes
- range: 1T to 2T

1.4 billion × 1 KB = **1.4 TB a day**.

Numbers: [Numbers to know](../docs/numbers/).
