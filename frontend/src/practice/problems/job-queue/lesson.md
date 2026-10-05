# Durable Job Queue: putting a log in front of a queue that can fill up

Slack runs a lot of work in the background, and all of it went through one Redis-backed job queue. When workers slowed down during a database incident, Redis filled up and refused new jobs. This lesson shows why, and how a durable log in front of Redis fixes it without rewriting the workers.

## What you'll learn

- Why an in-memory queue is a fragile place to *accept* work, and what "durable buffer" means in practice.
- How at-least-once delivery works with a log like Kafka: process first, commit the offset second.
- Why a small stateless gateway in front of a broker beats a broker client in every web request.
- How to size a stateless tier from load and per-replica capacity, with headroom for a lost machine.
- How to migrate an architecture incrementally: change what sits in front, keep what the workers already use.

## The problem, explained

**Who uses it.** The "user" here is Slack's own web application. Every time a request needs slow work done, the PHP web app enqueues a job and moves on. Workers pick jobs up and run them. Nobody outside the company calls this system, but every user feels it when it breaks.

**What went wrong.** Before the fix, the web app pushed jobs straight into Redis lists and workers popped them off. Redis keeps everything in memory. When workers slowed down, jobs piled up, Redis hit its memory limit, and from then on every enqueue failed. A slowdown in one place (the database the workers used) turned into an outage everywhere (nothing could be enqueued).

**Functional requirements.**

- **Enqueue**: the web app hands off a job with one HTTP call to a small stateless gateway, which produces it to Kafka. The web app gets its answer only once the job is durably stored.
- **Relay**: a relay service takes the next job from Kafka and pushes it into Redis. Two scenarios: `"Relayed"` (Redis accepts, the relay commits the Kafka offset) and `"Redis full"` (Redis refuses or is down; the job stays in Kafka for a retry).
- **Run job**: workers take jobs from Redis exactly as before.

**Non-functional requirements.** p99 of Enqueue under 50 ms, Enqueue available 99.99% of the time, the job written to a durable store before the web app hears back, any single machine can fail, and the whole thing costs at most $8,000 a month including the existing web app and workers.

**What is given.** `given.proschi` fixes the `web` app (four replicas) and the `workers` (eight replicas), because they already exist and the point of the exercise is *not* to rewrite them. It also fixes the traffic: 33k requests per second for each of the three use cases, with 0.1% of relays hitting a full Redis.

**What the tests check**, in plain words:

- *Enqueuing never touches Redis*: the Enqueue use case starts at the web app, writes to a queue before answering, never calls a cache, and there is no connection at all from the web app to a cache.
- *The web app enqueues through a stateless gateway*: on the Enqueue path a service comes before the queue, and the web app has no direct connection to any queue.
- *Only the relay moves jobs from Kafka to Redis*: Relay starts at the queue, its `"Relayed"` scenario writes to the cache before it finishes, and Run job starts at the workers and reads the cache, never Kafka.
- *A full Redis leaves the job in Kafka*: Relay has a scenario where the call to the cache fails and the use case still completes.

## Back-of-the-envelope

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

The job size is an assumption, not a published number, but it tells you something important: a day of backlog is a few terabytes, which is trivial for disks and impossible for the RAM of a single Redis. That is the whole argument for a log in front.

**How many replicas?** The general formula is:

> replicas needed = load ÷ (capacity per replica × target utilisation)

In Proschi a generic service replica (`[Go]` is a service) handles 2k requests a second. At 100% you would need 33k ÷ 2k = 16.5 replicas just to keep up, which means you are already saturated. Real systems aim well below 100% because queueing delay explodes near the limit; the model shows a node as "hot" above 70%. So divide by 0.7, round up, and then check one more thing: `survive any node failure` re-runs the whole analysis with one replica fewer, and the tier must still stay under 100%. Do that arithmetic for both the gateway and the relay; they carry the same 33k rps.

**What the simulation does with it.** Kafka is a queue node with 50k writes per replica, so three brokers are lightly loaded. Redis is a cache with 100k operations per replica and, unlike a relational database, takes writes on every replica. The services are the bottleneck, and the M/M/c queueing formula in the model means a big pool at 70% still answers in about its base 10 ms; a single replica at 70% would take more than three times that. Enqueue's p99 is the gateway hop plus the Kafka hop with their exponential tails, comfortably inside 50 ms when nothing is hot.

**Cost.** Each service replica costs $100 a month, a Kafka broker $200 and a Redis replica $150. The web app and workers already take $1,200 of the $8,000. Every gateway or relay replica you add costs $100, so throwing replicas at the problem runs out of budget quickly. That is deliberate: the budget forces you to size, not guess.

**Availability.** The Enqueue path is gateway then Kafka. Each service replica is up 99.5% of the time, but a pool of many is up when any one is, so the pool is effectively always up in the model. The 99.99% target is easy once nothing on the path is a single replica; with one Kafka broker or one gateway it would not be.

## Concepts

### A durable log as a buffer

A *queue* in the loose sense is anything that holds work between a producer and a consumer. Two very different things go by that name:

- An **in-memory queue** (a Redis list) is fast and simple, but its capacity is RAM. When consumers fall behind, it fills, and then it must either refuse work or evict it.
- A **durable log** (Kafka, Kinesis, Pulsar) appends every message to disk on several machines and lets consumers read at their own pace. A backlog of hours is normal, not an emergency.

The key property is *decoupling under failure*: when the consumer side is slow, the producer side keeps working. The backlog lives on disk until consumers catch up.

The trade-offs: a log adds a hop and an operational system to run; consumers track their own position (the *offset*); and a log is a poor fit for per-message features such as delays, priorities or individually acknowledged retries, which is one reason Slack kept Redis behind it rather than pointing workers straight at Kafka.

When *not* to use it: when the work is cheap and synchronous anyway, or when the volume is small enough that a managed queue with built-in retries (SQS, for example) does the whole job.

### At-least-once delivery: commit after the side effect

A consumer of a log does two things for every message: performs its side effect (here, pushing into Redis) and records that it is done (committing the offset). The order matters:

- **Commit first, then process**: if the process dies in between, the message is skipped forever. That is *at-most-once*.
- **Process first, then commit**: if the process dies in between, the message is processed again after a restart. That is *at-least-once*.

Losing jobs is worse than running one twice, so job systems pick at-least-once and make the jobs (or the step that consumes them) *idempotent*, meaning running them twice has the same effect as running them once. The Kafka documentation's "Message Delivery Semantics" section describes exactly this choice.

In Proschi you express the two outcomes as scenarios. The failed side effect uses `-x`, which models a call that never gets an answer, and the scenario still completes without committing:

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

### Back pressure belongs in the right place

*Back pressure* is how a system tells producers to slow down when it is full. The System Design Primer describes the classic version: bound the queue and answer "busy, try later" when it is full. That is exactly what Redis did, and it was correct behaviour for Redis. The mistake was that the *web app* was the one receiving the "busy". The fix moves the pressure boundary: the relay is the only client that ever hits a full Redis, and its answer to "busy" is simply to wait, because the job is safe in Kafka.

A useful rule: put the component that can absorb a backlog between the component that must never stop (accepting work) and the component that can stop (running it).

### A stateless gateway in front of a broker

Kafka clients keep long-lived connections to the brokers, learn which broker leads which partition, and batch messages. A PHP process lives for one request, so it would open a fresh connection every time and carry broker topology into the web app. A small stateless service (Slack's Kafkagate) holds the connections and exposes one HTTP endpoint. Stateless means any replica can serve any request, so you scale it by adding replicas and lose nothing when one dies.

The trade-off is one more hop and one more service to deploy. It pays off when clients are many, short-lived or lack a good broker client; it does not when a few long-running services can embed one.

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

## Designing it step by step

**1. Scope.** Confirm what "enqueue succeeded" must mean: the job is on disk somewhere replicated, not just in a process's memory. Confirm that workers and Redis stay (the migration constraint), the peak rate (33k/s), and that ordering across jobs is not required. Ask what happens today when Redis is full: enqueues fail. That is the failure you are designing away.

**2. High-level design.** Draw the minimal chain that respects the constraints: web app → something stateless → durable log → something that moves jobs → Redis → workers. Three use cases fall out naturally:

- Enqueue: web → gateway → Kafka, with the answer after Kafka's acknowledgement.
- Relay: starts *at* Kafka, because the log hands the job to the relay. Then the relay pushes to Redis.
- Run job: unchanged, workers pop from Redis.

An alternative you should mention and reject: point the workers at Kafka and drop Redis. It removes a component, but it means rewriting every worker at once and losing Redis queue features they rely on. The problem forbids it, and the test *Only the relay moves jobs from Kafka to Redis* encodes that.

**3. Deep dive.** Three places deserve time.

- *The relay's two outcomes.* Model `"Relayed"` with a successful push and a commit, and `"Redis full"` with a failed push (`-x`) and no commit. The second scenario is what the model reads as a fallback for the cache: the use case completes even though Redis did not answer.
- *Sizing.* Use the back-of-the-envelope formula for the gateway and the relay. Choose counts that keep each under 70% and still under 100% with one replica lost. Give Kafka and Redis at least two replicas each so neither is a single point of failure; Kafka with three is the conventional minimum for replicated partitions.
- *Acknowledgement level.* Slack's gateway waits only for the partition leader's acknowledgement, not for all replicas. That lowers enqueue latency; the cost is that a job can be lost if the leader dies before it replicates. Say this out loud, it is a real durability trade-off. Proschi does not model replication acknowledgements, so it does not change the numbers here.

**4. Wrap-up.** Check every requirement against your design: Enqueue p99 is two short hops; the path has no single replica; cost fits with room; every test's flow holds. Then name what you would do next: alert on consumer lag (how far the relay is behind Kafka), cap the relay's push rate so a recovering Redis is not flooded, and add a dead-letter topic for jobs that fail repeatedly.

## Common mistakes

**Keep enqueueing into Redis** (`wrong/enqueue-into-redis`). The web app still pushes straight into Redis, even with Kafka sitting next to it. This is the original outage waiting to happen again: the next time workers slow down, Redis fills and the web app's enqueues fail. It fails *Enqueuing never touches Redis* (the web app is connected to a cache) and *The web app enqueues through a stateless gateway*.

**Write to Kafka, then also to Redis before answering** (`wrong/enqueue-waits-for-redis`). It looks safer: the job is in both places. But the answer now waits for Redis, so a full Redis fails the enqueue exactly as before, and the relay will push a duplicate later. It fails *Enqueuing never touches Redis*.

**A relay that commits even when Redis refused** (`wrong/relay-ignores-full-redis`). The relay gets an out-of-memory error from Redis and commits the offset anyway. The job is now gone from Kafka's point of view and never made it into Redis: silent data loss, the worst kind. It fails *A full Redis leaves the job in Kafka*, because no scenario shows a failed call to the cache that the use case survives.

**The web app talks to Kafka directly** (`wrong/web-produces-to-kafka`). It works on a whiteboard but in production every short-lived PHP request opens broker connections and must know the cluster layout. It fails *The web app enqueues through a stateless gateway*.

**Rewrite the workers to read Kafka** (`wrong/workers-read-kafka`). Tempting because it deletes a component, but it is a big-bang migration of every job type, and the problem says the workers stay as they are. It fails *Only the relay moves jobs from Kafka to Redis*.

**Other classic mistakes.**

- *One gateway or one Kafka broker.* Fails `survive any node failure`, and in the real world a deploy or a dead disk stops all enqueues.
- *Sizing tiers to exactly 100%.* 17 gateway replicas technically keep up with 33k rps, but the model treats that as saturated or close to it, and losing one replica tips it over. Queueing delay grows sharply as utilisation approaches 1.
- *Over-provisioning to be safe.* Doubling both stateless tiers blows the $8,000 budget. Sizing is part of the answer.

## In the interview

Lead with the failure story, because it justifies the whole design: "Accepting work must not depend on the health of the system that runs it. Today it does, because Redis is both the intake and the work queue." Then draw the chain and explain each box in one sentence.

Questions you are likely to get, with short answers:

- *What if Kafka is down?* Then enqueues fail, but Kafka is a replicated cluster designed for exactly this role, and far less likely to be "full" than RAM. You can add a small local spool on the gateway as a last resort.
- *Can a job run twice?* Yes. A relay can push to Redis and crash before committing, and the next relay pushes again. Make jobs idempotent, for example with a job id that the worker checks before doing a side effect.
- *How do you keep ordering?* Kafka orders within a partition. Choose a partition key (a team or channel id) when order matters for that key; across keys, do not promise order.
- *Why not leader-and-all-replicas acknowledgements?* Higher latency on every enqueue. It is a dial: Slack chose leader-only acks. Mention you would revisit it for jobs where loss is unacceptable, such as billing.
- *How do you run exactly one relay per topic?* Slack used a lock in Consul per topic; if the holder dies, another relay takes the lock. Consumer groups in Kafka are the more common modern answer.
- *What do you monitor?* Consumer lag per topic, Redis memory, relay error rate, and enqueue latency at the gateway.

## Further reading

- [Scaling Slack's Job Queue](https://slack.engineering/scaling-slacks-job-queue/), Slack Engineering, 2017: the outage, Kafkagate, JQRelay and the migration this problem is based on.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): the "Message queues", "Task queues" and "Back pressure" subsections give the vocabulary used above.
- [Apache Kafka design documentation](https://github.com/apache/kafka/blob/trunk/docs/design/design.md): see "Message Delivery Semantics" for at-most-once, at-least-once and exactly-once.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Scalability section lists many production queue write-ups (Slack, Quora's Qmessage, Uber's Cherami, Airbnb's Dynein).
- [awesome-system-design](https://github.com/madd86/awesome-system-design): the "Message Broker" section links the main brokers (Kafka, RabbitMQ and others) to compare.
- *System Design Interview – An Insider's Guide, Volume 2* (Alex Xu and Sahn Lam), chapter "Distributed Message Queue".
