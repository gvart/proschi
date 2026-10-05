---
title: Durable Job Queue
summary: "Slack's job queue: Kafka in front of Redis, so a full Redis loses nothing."
difficulty: medium
tags: [queues, durability, availability, migration, real-world]
company: Slack
hints:
  - "The outage came from Redis refusing enqueues once it was full. Put something durable, that can hold a backlog on disk, between the web app and Redis."
  - "The web app is PHP and should not talk to Kafka brokers itself: give it one HTTP call to a small stateless service that produces to Kafka. The answer comes after the broker's ack, and nothing on that path touches Redis."
  - "\"Relay\" starts at Kafka: a relay pushes the job into Redis and only then commits the offset. In \"Redis full\" the push fails (-x), the offset is not committed, and the job waits in Kafka for a retry. The workers keep reading Redis as before."
  - "Size the gateway and the relay for 33k rps each at well under 70% busy (about 2k rps per replica), and keep them under 100% with one replica lost; the budget has little room for more."
---

Slack runs everything too slow for a web request as a background job:
posting messages, push notifications, link unfurls, reminders, billing. The
web app pushed jobs into Redis, and workers took them from there. Then
workers fell behind during a database incident, Redis reached its memory
limit and refused new jobs, and the web app could no longer enqueue
anything.

The fix: keep Redis and the workers as they are, and put Kafka in front of
Redis as a durable buffer.

## Functional requirements

- **Enqueue**: the web app hands off a job and gets an answer once the job
  is durably stored. The web app is PHP: it makes one HTTP call to a small,
  stateless gateway service, which produces the job to Kafka.
- **Relay**: a relay service takes the next job from Kafka and pushes it into
  the Redis queue the workers read. Two scenarios:
  - `"Relayed"`: Redis takes the job, and the relay commits the Kafka offset.
  - `"Redis full"`: Redis refuses or is down; the job stays in Kafka and is
    retried later.
- **Run job**: a worker takes the next job from Redis, as it always did.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **1.4 billion jobs** on the busiest days, at a peak of **33k jobs per
  second**: that is the rate of all three use cases.
- About **0.1%** of relays find Redis unable to take the job.

## Constraints

- An enqueue never touches Redis: no connection from the web app to Redis,
  and none on the Enqueue path.
- The web app never talks to Kafka directly.
- The job is written to Kafka before the web app hears back.
- p99 of **Enqueue** under **50 ms**.
- Enqueue available **99.99%** of the time.
- Losing any single machine must not stop jobs.
- At most **$8,000 / month**, the web app and the workers included.

## What is given

`problem.proschi` declares the `web` app (four replicas) and the existing
`workers` (eight replicas), and holds the traffic, requirements and tests.
Add the gateway, Kafka, the relay, Redis, the connections and the three use
cases.

## Based on

- [Scaling Slack's Job Queue](https://slack.engineering/scaling-slacks-job-queue/),
  Slack Engineering, December 2017: 1.4 billion jobs a day at a peak of
  33,000 per second, the Redis memory outage, Kafka added in front of Redis,
  Kafkagate (a Go HTTP service that waits only for the partition leader's
  ack) and JQRelay (one relay per topic under a Consul lock, retrying failed
  jobs from Kafka).
