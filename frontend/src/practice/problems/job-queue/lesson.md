# Durable Job Queue: putting a log in front of a queue that can fill up

```tldr
Redis was both the **intake** and the work queue, so slow workers filled it and every enqueue failed. Put a **durable log (Kafka)** in front, reached through a **stateless HTTP gateway**, and let a **relay** move jobs into Redis, committing the offset **only after** Redis accepts them. Workers stay exactly as they are.
```

Slack ran all its background work through one Redis-backed job queue. When workers slowed during a database incident, Redis filled up and refused new jobs. This lesson shows why, and how a durable log in front of Redis fixes it without rewriting the workers.

## What you'll learn

- Why an in-memory queue is a fragile place to *accept* work, and what "durable buffer" means in practice.
- How at-least-once delivery works with a log like Kafka: process first, commit the offset second.
- Why a small stateless gateway in front of a broker beats a broker client in every web request.
- How to size a stateless tier from load and per-replica capacity, with headroom for a lost machine.
- How to migrate an architecture incrementally: change what sits in front, keep what the workers already use.

## The problem, explained

**Who uses it.** Slack's own PHP web app: whenever a request needs slow work done, it enqueues a job and moves on, and workers run it. Nobody outside the company calls this system, but every user feels it when it breaks.

**What went wrong.** The web app pushed jobs straight into Redis lists and workers popped them off. Redis keeps everything in memory: when workers slowed, jobs piled up, Redis hit its memory limit, and every enqueue failed. A slowdown in one place (the workers' database) became an outage everywhere.

**Functional requirements.**

- **Enqueue**: the web app makes one HTTP call to a small stateless gateway, which produces the job to Kafka; the answer comes once the job is durably stored.
- **Relay**: a relay service takes the next job from Kafka and pushes it into Redis. Two scenarios: `"Relayed"` (Redis accepts, the relay commits the Kafka offset) and `"Redis full"` (Redis refuses or is down; the job stays in Kafka for a retry).
- **Run job**: workers take jobs from Redis exactly as before.

**Non-functional requirements.** Enqueue p99 under 50 ms (99% of enqueues are faster) and 99.99% available; the job durably stored before the web app hears back; any single machine can fail; at most $8,000 a month including the existing web app and workers.

**What is given.** `given.proschi` fixes the `web` app (four replicas) and the `workers` (eight replicas), which already exist and are *not* to be rewritten, and the traffic: 33k requests per second for each use case, with 0.1% of relays hitting a full Redis.

**What the tests check:**

- *Enqueuing never touches Redis*: Enqueue starts at the web app, writes to a queue before answering, never calls a cache, and there is no connection at all from the web app to a cache.
- *The web app enqueues through a stateless gateway*: on the Enqueue path a service comes before the queue, and the web app has no direct connection to any queue.
- *Only the relay moves jobs from Kafka to Redis*: Relay starts at the queue, its `"Relayed"` scenario writes to the cache before it finishes, and Run job starts at the workers and reads the cache, never Kafka.
- *A full Redis leaves the job in Kafka*: Relay has a scenario where the call to the cache fails and the use case still completes.

## Back-of-the-envelope

```numbers
33k/s | peak jobs, for each use case
≈ 16k/s | average on a 1.4B-job day
66k rps | Redis load (pushes + pops)
33/s | relays that find Redis full
≈ 1.4 TB | Kafka disk per day
```

Start from the published numbers: 1.4 billion jobs on the busiest days, with a peak of 33,000 a second.

| Quantity | Arithmetic | Result |
|---|---|---|
| Average rate on a busy day | 1.4B ÷ 86,400 s | about 16k jobs/s |
| Peak to average | 33k ÷ 16k | about 2× |
| Gateway load | every enqueue is one HTTP call | 33k rps |
| Kafka writes | one produce per job | 33k rps |
| Relay load | one job delivered per relay step | 33k rps |
| Redis load | 33k pushes from the relay + 33k pops from workers | 66k rps |
| Relays that find Redis full | 0.1% × 33k | 33 per second |
| Kafka disk per day (assume ~1 KB per job) | 1.4B × 1 KB | about 1.4 TB/day |

The job size is an assumption, but it makes the point: a day of backlog is more than a terabyte (a few once Kafka replicates it). Easy for disks, impossible for the RAM of a single Redis: that is the whole argument for a log in front.

**How many replicas?**

```callout tip The sizing formula
replicas needed = load ÷ (capacity per replica × target utilisation)
```

A service replica (`[Go]` is a service) handles 2k requests a second, so 33k ÷ 2k = 16.5 replicas would just keep up, saturated. Queueing delay explodes near the limit, and the model flags a node as "hot" above 70%. Divide by 0.7, round up, then check that `survive any node failure` (one replica fewer) still leaves the tier under 100%. The gateway and the relay both carry 33k rps.

```quiz
servers-for-peak-load
```

**What the simulation does with it.** Kafka is a queue node with 50k writes per replica, so three brokers are lightly loaded. Redis is a cache with 100k operations per replica and, unlike a relational database in the model, takes writes on every replica. The services are the bottleneck: with the M/M/c queueing formula, a big pool at 70% still answers in about its base 10 ms, a single replica at 70% in more than three times that. Enqueue's p99 (gateway hop plus Kafka hop, with their exponential tails) is comfortably inside 50 ms when nothing is hot.

**Cost.** A service replica is $100 a month, a Kafka broker $200, a Redis replica $150. The web app and workers already take $1,200 of the $8,000. The budget deliberately forces you to size, not guess.

**Availability.** The Enqueue path is the gateway, then Kafka. A service replica is up 99.5% of the time, but a pool is up while any replica is, so in the model a large pool is effectively always up. 99.99% is easy once nothing on the path is a single replica.

## Concepts

### A durable log as a buffer

A *queue* in the loose sense is anything that holds work between a producer and a consumer. Two very different things go by that name:

| | In-memory queue (a Redis list) | Durable log (Kafka, Kinesis, Pulsar) |
|---|---|---|
| Where messages live | RAM | Appended to disk on several machines |
| When consumers fall behind | It fills, then must refuse or evict work | Consumers read at their own pace; a backlog of hours is normal |
| Strength | Fast and simple | Survives a slow consumer side |

The key property is *decoupling under failure*: a slow consumer side leaves the producer side working, and the backlog waits on disk.

The trade-offs: a log adds a hop and one more system to operate, and consumers track their own position (the *offset*). It is also a poor fit for per-message delays, priorities or retries, one reason Slack kept Redis behind it rather than pointing workers at Kafka.

When *not* to use it: cheap, synchronous work, or volumes small enough for a managed queue with built-in retries (SQS, say).

### At-least-once delivery: commit after the side effect

A log consumer performs its side effect (here, pushing into Redis) and records that it is done (committing the offset). The order matters:

- **Commit first, then process**: a crash in between skips the message forever. That is *at-most-once*.
- **Process first, then commit**: a crash in between processes it again after a restart. That is *at-least-once*.

Losing jobs is worse than running one twice, so job systems pick at-least-once and make the jobs (or the consuming step) *idempotent*: running twice has the same effect as once. Kafka's "Message Delivery Semantics" documentation describes exactly this choice.

```callout pitfall Never commit a job that went nowhere
A relay that commits the offset after Redis refused the push has deleted the job from Kafka's point of view without delivering it: silent data loss.
```

In Proschi the two outcomes are scenarios. The failed side effect uses `-x` (a call that never gets an answer), and the scenario still completes without committing:

```proschi
title "Buffered hand-off"

app    "App"        [REST API] x2
log    "Job Log"    [Kafka]    x3
mover  "Mover"      [Worker]   x2
target "Downstream" [Database] x2

app   -> log    : produce
log   -> mover  : consume
mover -> target : write

usecase "Move" {
  log -> mover : JobCreated offset 42

  alt "Done" {
    mover   -> target : UPSERT job 42
    target --> mover  : ok
    mover  --> log    : commit offset 42
  } alt "Downstream busy" {
    mover  -x target : UPSERT job 42
    mover --> log    : keep offset, retry with backoff
  }
}
```

```quiz
offset-commit-timing
at-least-once-needs-idempotency
```

### Back pressure belongs in the right place

*Back pressure* is how a system tells producers to slow down when it is full. The System Design Primer's classic version: bound the queue and answer "busy, try later" when it is full. That is what Redis did, correctly. The mistake was that the *web app* received the "busy".

The fix moves the pressure boundary: only the relay ever hits a full Redis, and it simply waits, because the job is safe in Kafka.

```callout takeaway
Put the component that can absorb a backlog between the component that must never stop (accepting work) and the component that can stop (running it).
```

```quiz
backpressure
```

### A stateless gateway in front of a broker

Kafka clients keep long-lived broker connections, learn which broker leads which partition, and batch messages. A PHP process lives for one request: it would reconnect every time and need to know the broker topology. A small stateless service (Slack's Kafkagate) holds the connections and exposes one HTTP endpoint. Any replica can serve any request, so you scale by adding replicas and lose nothing when one dies.

The cost is one more hop and one more service. It pays off when clients are many, short-lived or lack a good broker client, not when a few long-running services can embed one.

````deepdive In Proschi: produce over HTTP
```proschi
title "Produce over HTTP"

cli "Short-lived Client" [REST API] x2
gw  "Produce Gateway"    [Go]       x2
bus "Event Log"          [Kafka]    x3

cli -> gw  : HTTP
gw  -> bus : produce

usecase "Publish event" {
  cli  -> gw  : POST /events json {"topic": "audit"}
  gw   -> bus : PRODUCE audit
  bus --> gw  : ack
  gw  --> cli : 202
}
```
````

## Designing it step by step

**1. Scope.** Confirm that "enqueue succeeded" means the job is on replicated disk, not in a process's memory; that workers and Redis stay (the migration constraint); the peak rate (33k/s); and that ordering across jobs is not required. Ask what happens today when Redis is full: enqueues fail. That is the failure you are designing away.

**2. High-level design.** The minimal chain: web app → something stateless → durable log → something that moves jobs → Redis → workers. Three use cases fall out:

- Enqueue: web → gateway → Kafka, answering after Kafka's acknowledgement.
- Relay: starts *at* Kafka, because the log hands the job to the relay, which pushes to Redis.
- Run job: unchanged, workers pop from Redis.

Mention and reject one alternative: workers reading Kafka, with no Redis. It removes a component but rewrites every worker at once and loses Redis queue features they rely on; *Only the relay moves jobs from Kafka to Redis* forbids it.

**3. Deep dive.** Three places deserve time.

- *The relay's two outcomes.* `"Relayed"`: a successful push and a commit. `"Redis full"`: a failed push (`-x`) and no commit, which the model reads as a fallback for the cache.
- *Sizing.* The formula above for the gateway and the relay: under 70%, and under 100% with one replica lost. At least two replicas for Kafka and Redis so neither is a single point of failure; three is the conventional minimum for Kafka's replicated partitions.
- *Acknowledgement level.* Slack's gateway waits only for the partition leader's acknowledgement, which lowers enqueue latency.

```deepdive Leader-only acknowledgements: a durability trade-off
Waiting only for the leader, not for all replicas, means a job can be lost if the leader dies before the job is replicated. Say this out loud: it is a real durability trade-off. Proschi does not model replication acknowledgements, so it does not change the numbers here.
```

**4. Wrap-up.** Check every requirement: Enqueue p99 is two short hops, no single replica on the path, cost fits, every test's flow holds. Then name what comes next: alert on consumer lag (how far the relay is behind Kafka), cap the relay's push rate so a recovering Redis is not flooded, and a dead-letter topic for jobs that fail repeatedly.

## Common mistakes

**Keep enqueueing into Redis** (`wrong/enqueue-into-redis`). The web app still pushes straight into Redis, even with Kafka next to it: the original outage, waiting for the next slowdown. It fails *Enqueuing never touches Redis* (the web app is connected to a cache) and *The web app enqueues through a stateless gateway*.

**Write to Kafka, then also to Redis before answering** (`wrong/enqueue-waits-for-redis`). The job is in both places, but the answer waits for Redis, so a full Redis fails the enqueue as before, and the relay pushes a duplicate later. It fails *Enqueuing never touches Redis*.

**A relay that commits even when Redis refused** (`wrong/relay-ignores-full-redis`). Redis answers out-of-memory and the relay commits anyway: the job never reached Redis and is gone from Kafka's point of view. Silent data loss, the worst kind. It fails *A full Redis leaves the job in Kafka*, because no scenario shows a failed call to the cache that the use case survives.

**The web app talks to Kafka directly** (`wrong/web-produces-to-kafka`). In production every short-lived PHP request opens broker connections and must know the cluster layout. It fails *The web app enqueues through a stateless gateway*.

**Rewrite the workers to read Kafka** (`wrong/workers-read-kafka`). It deletes a component, but it is a big-bang migration of every job type, and the workers must stay as they are. It fails *Only the relay moves jobs from Kafka to Redis*.

**Other classic mistakes.**

- *One gateway or one Kafka broker.* Fails `survive any node failure`; in the real world a deploy or a dead disk stops all enqueues.
- *Sizing tiers to exactly 100%.* 17 gateway replicas technically keep up with 33k rps, but that is close to saturated, and losing one tips it over: queueing delay grows sharply as utilisation approaches 1.
- *Over-provisioning to be safe.* Doubling both stateless tiers blows the $8,000 budget. Sizing is part of the answer.

## In the interview

Lead with the failure story: it justifies the whole design. Then draw the chain, one sentence per box.

```callout interview Open with the failure
"Accepting work must not depend on the health of the system that runs it. Today it does, because Redis is both the intake and the work queue."
```

Likely questions, with short answers:

- *What if Kafka is down?* Then enqueues fail. But Kafka is a replicated cluster built for this role, and disks fill far less readily than RAM. A small local spool on the gateway is a last resort.
- *Can a job run twice?* Yes: a relay can push to Redis and crash before committing. Make jobs idempotent, for example with a job id the worker checks before a side effect.
- *How do you keep ordering?* Kafka orders within a partition. Choose a partition key (a team or channel id) when order matters for that key; across keys, do not promise order.
- *Why not acknowledgements from all replicas?* Higher latency on every enqueue. Slack chose leader-only acks; revisit that for jobs where loss is unacceptable, such as billing.
- *How do you run exactly one relay per topic?* Slack used a Consul lock per topic, taken over by another relay if the holder dies. Kafka consumer groups are the more common modern answer.
- *What do you monitor?* Consumer lag per topic, Redis memory, relay error rate, and enqueue latency at the gateway.

## Further reading

- [Scaling Slack's Job Queue](https://slack.engineering/scaling-slacks-job-queue/), Slack Engineering, 2017: the outage, Kafkagate, JQRelay and the migration this problem is based on.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): the "Message queues", "Task queues" and "Back pressure" subsections give the vocabulary used above.
- [Apache Kafka design documentation](https://github.com/apache/kafka/blob/trunk/docs/design/design.md): see "Message Delivery Semantics" for at-most-once, at-least-once and exactly-once.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Scalability section lists many production queue write-ups (Slack, Quora's Qmessage, Uber's Cherami, Airbnb's Dynein).
- [awesome-system-design](https://github.com/madd86/awesome-system-design): the "Message Broker" section links the main brokers (Kafka, RabbitMQ and others) to compare.
- *System Design Interview – An Insider's Guide, Volume 2* (Alex Xu and Sahn Lam), chapter "Distributed Message Queue".
