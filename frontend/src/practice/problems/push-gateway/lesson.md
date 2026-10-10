```tldr
Ten million devices hold open connections, so a message must find **the one push server** holding its customer's socket: a **connection registry** with a TTL (customer → server) does that. Senders only **write a durable queue** and get an ack; processors look up the registry and deliver. Push is **best effort**: offline and stale routes are dropped, and the **reconnect rate** (≈ 5.5k a second), not the socket count, is what becomes load.
```

Polling keeps an app fresh but wastes requests: almost every answer is "no". Netflix's Zuul Push turned it around: every app keeps one long-lived connection open, and the backend speaks only when it has something to say. This lesson is about routing once millions of those connections are spread over a fleet.

## What you'll learn

- Why a stateful connection fleet needs a **connection registry**, and what that registry must be good at (fast reads, expiry, sharding, replication).
- How a **queue between senders and push servers** keeps dozens of backend services simple, fast and durable.
- Why push is usually **best effort**, and how to model the three delivery outcomes: online, offline and a stale route.
- How to size a fleet from connection churn rather than from the number of open sockets, and where Proschi's model stops.

## The problem, explained

Every Netflix app opens a WebSocket or Server-Sent Events (SSE) connection and keeps it open. A WebSocket starts as an HTTP request with an `Upgrade` header; the server answers `101 Switching Protocols`, and from then on either side can send frames at any time. SSE is the one-way version: the server streams events to the client over plain HTTP.

On the other side, many backend services want to tell a customer's devices "you have new data", without caring which push server holds the socket or waiting for arrival.

The functional requirements are three use cases:

- **Connect**: a device reaches a push server through a load balancer. The push server authenticates it, records "customer X is on server Y" in the **push registry** with an expiry, and answers `101`.
- **Send**: a backend service hands over a message with a one-line library call and gets an acknowledgement as soon as the message is safely accepted.
- **Deliver**: a message processor takes the message from the queue, looks the customer up in the registry and hands it to exactly that push server, which writes it down the socket. Three outcomes: `"Online"` (delivered), `"Offline"` (no record, drop it) and `"Stale route"` (the record points at a server that died; the call fails, drop it).

The non-functional side:

| Requirement | Target |
|---|---|
| Send | p99 under 30 ms, 99.99% available |
| Connect | p99 under 60 ms, 99.9% available |
| Online delivery path | p99 under 100 ms |
| Durability | An accepted message is written durably before the sender hears back |
| Fault tolerance | Losing any single machine must not stop connecting or pushing |
| Budget | $5,000 a month, including the senders |

The given file fixes the two ends, the `device` actor and the `senders` (four replicas of a backend service); everything in between is yours. Its tests encode the key ideas:

- Senders write a queue before responding, never wait for the push servers or the registry, and have no path to the push servers at all.
- Connect starts at the device, writes the registry before answering `101`, and the device itself never touches the registry.
- Deliver starts at a queue, reads the registry before calling a push server, reaches the device when online, never calls a push server when offline, and handles a push server that is down.

The tests refer to nodes by id, so the push servers must be called `push` and the registry `registry`.

## Back-of-the-envelope

```numbers
10M | concurrent connections
≈ 5.5k/s | connects (10M ÷ 1,800 s)
20k/s | messages sent
17.5k/s | load on the push servers
≈ 1 GB | the whole registry in memory
```

Start from the statement's two numbers: 10 million concurrent connections, each living at most about 30 minutes.

**Connects per second.** If every connection is replaced at least every 1,800 seconds, with reconnects spread randomly, the steady-state connect rate is 10,000,000 / 1,800 ≈ 5,600 per second; the statement uses 5.5k. Netflix's Zuul wiki gives a registry TTL of 1,800 seconds and a "dither" window that randomises each client's lifetime, which keeps this rate smooth instead of spiky.

```callout takeaway
The **reconnect rate**, not the number of open sockets, is what turns into requests.
```

**Messages.** 20k messages a second, split by the mix:

| Outcome | Share | Rate |
|---|---|---|
| Online | 60% | 12,000/s |
| Offline | 38% | 7,600/s |
| Stale route | 2% | 400/s |

**Load per tier.**

| Node | Receives | Load |
|---|---|---|
| Queue | every Send | 20k writes/s |
| Message processors | every queued message | 20k/s |
| Registry | a write per connect, a read per message | 5.5k writes + 20k reads |
| Push servers | every connect plus every online delivery | 5.5k + 12k = 17.5k/s |

Push servers never see offline messages (the processor drops them), and in the model a failed call (`-x`) adds no load to its target, so stale routes don't count either.

**Replicas.** Proschi's default service profile handles about 2k requests per second per replica; replicas needed = load / per-replica capacity:

- Push servers: 17.5k / 2k ≈ 9 replicas just to stay under 100%. With headroom below the 70% "hot" line and one replica lost, you need noticeably more than 9.
- Processors: 20k / 2k = 10 at 100%; the same reasoning pushes you higher.
- Registry: a Redis-class cache takes about 100k operations per replica, so 25.5k is a small fraction of one node. You add replicas for failure, not load.
- PostgreSQL as the registry: its single primary takes about 5k writes a second, so 5.5k connects a second is 110%. Read replicas do not help writes.

**Memory, roughly.** A registry record (customer id, server id, expiry) is about 100 bytes with overhead; ten million is about 1 GB, comfortably in memory for a sharded cache.

```deepdive How this shows up in the simulation
Utilisation is load divided by capacity. Above 70% a node is hot; at 100% it is saturated, and every latency limit of a use case that touches it fails. Latency grows with utilisation (an M/M/c queue), so a pool at 60% adds little. A single replica of anything is a single point of failure. Cost is a flat price per replica (service $100, cache $150, queue $200, load balancer $50), and $400 of the budget is already the senders.
```

```callout pitfall The model counts requests, not sockets
It cannot see that one server holds hundreds of thousands of idle connections, nor the reconnect storm when it dies. Size by requests here; raise sockets and herds in the interview.
```

```quiz
websocket-servers-needed
```

## Concepts

### A connection registry (two-level lookup)

A push server keeps an in-memory map from customer id to socket. That is enough with one server; with a fleet, a sender holding a message for customer 81 has no idea which server to ask.

The Zuul wiki describes a two-step lookup. A **global registry**, off the box, maps customer to server; the chosen server then finds the socket in its own **local registry**. The global registry needs four properties:

| Property | Why |
|---|---|
| **Low read latency** | Every single message reads it |
| **Expiry (TTL)** | Servers die without cleaning up; a record nobody renews must vanish on its own |
| **Sharding** | Tens of millions of records and thousands of writes a second outgrow one machine |
| **Replication** | Losing it means nobody can route anything |

Redis (Netflix used Dynomite, a sharding and replication layer over Redis), Cassandra or DynamoDB all fit. A relational database fits poorly: no native expiry, and every connect is a write to a single primary.

When not to use it: with one push server, or when broadcasting to a topic every server subscribes to anyway (chat rooms with members on every server), a registry is overhead.

```proschi
title "Connection registry pattern"

client   "Client"           [Actor]
gw       "Socket Servers"   [Java]  x4
registry "Session Registry" [Redis] x3
router   "Router"           [Java]  x2

client -> gw
gw     -> registry : RESP
router -> registry : RESP
router -> gw       : forward

usecase "Open socket" {
  client   -> gw       : GET /ws (Upgrade: websocket)
  gw       -> registry : SET session:user-7 gw-2 EX 600
  registry --> gw      : OK
  gw      --> client   : 101 Switching Protocols
}

usecase "Route message" {
  router   -> registry : GET session:user-7
  registry --> router  : gw-2
  router   -> gw       : forward to user-7
  gw       -> client   : frame
  gw      --> router   : ok
}
```

```quiz
routing-to-a-websocket
stateful-gateways
```

### A queue between many senders and the delivery fleet

Calling push servers directly, every sender would need registry access, wait for the whole delivery and carry retry logic for dead servers, and one service's burst would hit the fleet unfiltered.

A durable queue (Kafka at Netflix) in between fixes that. The sender's job ends at "the queue has it": one fast, highly available write. Message processors consume at their own pace and do the lookup and delivery. A burst becomes consumer lag (messages waiting in the queue) instead of failed requests, and partitioning by customer keeps one customer's messages in order.

The cost is a little latency and one more system to run. A single sender that needs synchronous confirmation of delivery gains nothing from the extra hop.

````deepdive A decoupled producer in Proschi
```proschi
title "Decoupled producer"

producer "Producer"  [REST API] x2
queue    "Queue"     [Kafka]    x3
worker   "Consumer"  [Go]       x2

producer -> queue  : produce
queue    -> worker : consume

usecase "Publish" {
  producer -> queue    : PRODUCE events {"user": "user-7"}
  queue   --> producer : ack
}

usecase "Consume" {
  queue   -> worker : Event user-7
  worker --> queue  : commit offset
}
```
````

### Best-effort delivery and stale routes

Push messages at Netflix are hints ("there are new recommendations"), not the data itself. An offline device fetches fresh data when it next connects, so there is nothing to store and redeliver. That choice separates this problem from **Chat**, where every message must be stored and delivered later.

Best effort still has to fail cleanly. A registry record can outlive its server: it crashed, its connections are gone, and the TTL has not fired. The processor's call fails, and the right behaviour is to drop the message and move on, not retry forever or crash.

In Proschi, "this node is down in this scenario" is a failed call, `-x`. The model charges it a fixed 1,000 ms timeout, which is why the latency requirement covers only `"Online"`: a stale route is slow by nature, acceptable for 2% of best-effort traffic.

When best effort is wrong: anything the user would notice missing (a chat message, a payment receipt). Then you need a store-and-forward inbox plus the push as a doorbell.

```proschi
title "Best-effort delivery"

worker "Dispatcher"   [Go]    x2
dir    "Directory"    [Redis] x2
node   "Edge Servers" [Go]    x4

worker -> dir  : RESP
worker -> node : deliver

usecase "Dispatch" {
  worker -> dir : GET route:user-7
  alt "Delivered" {
    dir   --> worker : edge-3
    worker -> node   : deliver to user-7
    node  --> worker : ok
  } alt "No route" {
    dir --> worker : nil
  } alt "Dead route" {
    dir    --> worker : edge-3
    worker  -x node   : deliver to user-7
  }
}
```

```quiz
push-is-best-effort
```

## Designing it step by step

**Step 1: scope.** Ask what a message is (a small hint), whether it is stored for offline devices (no), and who sends (many internal services). Pin 10M connections, 30-minute lifetime, 20k messages a second. Exactly-once is not required.

**Step 2: high-level design.** Draw two flows that meet in the middle.

The **connection flow**: device → load balancer → push server → registry. Run the load balancer at layer 4 (TCP) or make it WebSocket-aware, with a long idle timeout. The push server writes the registry before answering `101`, so a connected device is always findable.

The **message flow**: sender → queue (acknowledge here) → message processor → registry lookup → the one push server → device.

```callout pitfall Don't let senders call push servers
It fails three constraints at once: senders wait for delivery, nothing is durable before the answer, and senders now have a path to the push fleet.
```

**Step 3: deep dive.** Three questions are worth the time.

*Which store for the registry?* From the envelope: 5.5k writes and 20k reads a second, with expiry. A single PostgreSQL primary is already over its write capacity, and rows do not expire. DynamoDB or Cassandra would work, but at Proschi's price per replica, a few cost far more than an in-memory cache. Redis with `SET … EX` gives expiry for free and has capacity to spare; replicate it so losing one node changes nothing.

*Why not broadcast?* It needs no registry, but with N servers each message becomes N deliveries, N − 1 of them wasted.

*What happens on failure?* Model three branches in Deliver. Online: lookup, call push, push writes to the device. Offline: lookup returns nothing, stop. Stale route: lookup returns a server, the call fails (`-x push`), drop.

Then size each tier from the load table: well under 70%, still fitting with one replica gone, under budget, and the queue and registry at two replicas or more.

**Step 4: wrap-up.** Name what the model does not show: open sockets per server, the reconnect herd when a server dies, autoscaling by connection count, and cross-region routing.

## Common mistakes

**Broadcast to every server** (`wrong/broadcast-to-every-server`). With no registry, each message goes `x14` to the whole fleet, multiplying traffic and CPU by the fleet size: every scale-out makes it worse. In Proschi the push servers jump to roughly ten times their capacity and saturate, so the Connect p99 fails (with the Online p99 and `survive any node failure`); the flow tests fail too, because Connect no longer writes a registry and Deliver never reads one.

**The registry in PostgreSQL** (`wrong/registry-in-postgres`). Every connect is a write, and one primary takes about 5k writes a second; 5.5k connects is over the line, and read replicas only add read capacity. Rows do not expire either, so dead routes pile up until a cleanup job finds them. The saturated database fails `p99 of Connect < 60 ms` and `survive any node failure` (and the Online p99, since every delivery reads the registry).

**Senders call a push API** (`wrong/senders-call-push-api`). No queue: the sender's request does the lookup and the delivery before answering. Every sender waits for the slowest push server, a burst from one service hits the fleet directly, and nothing is stored before the acknowledgement. It fails "Senders hand messages to Kafka and never call push servers", the Send p99 and `Send is durable`; with no **Deliver** use case left, the delivery tests fail too.

**Classic mistakes worth naming too:**

- *No TTL on registry records.* Every crash leaves garbage that routes messages into the void forever.
- *An HTTP load balancer with default idle timeouts.* Quiet connections drop after about a minute (60 seconds is a common default), and the connect rate explodes.
- *Treating stale routes as errors to retry.* Retrying a dead server only delays the next message; drop and let the TTL clean up.

## In the interview

```callout interview Lead with the shape, then the arithmetic
"Two flows: devices connect and register where they are; senders enqueue and processors route to the right server." Draw it before any technology names. Then out loud: 10M connections over a 30-minute lifetime is about 5.5k connects a second; 20k messages a second become 20k registry reads and about 12k deliveries. That one table justifies the registry choice and the tier sizes.
```

Likely follow-ups and short answers:

- *What if a push server dies?* Clients reconnect elsewhere and re-register; old records expire. Jitter reconnects to avoid a herd; autoscale by connection count.
- *How do you deliver to a customer with three devices?* Store a set of server ids per customer (or a record per device) and fan out to each.
- *Do you guarantee delivery?* No, best effort by design; the app refreshes on reconnect. For guaranteed messages, add an inbox store and use push as a doorbell.
- *Why Kafka rather than direct calls?* Fast durable acknowledgement for senders, burst absorption, per-customer ordering by partition, and senders that know nothing about the fleet.

## Further reading

- [Scaling Push Messaging for Millions of Devices @Netflix](https://www.infoq.com/presentations/neflix-push-messaging-scale/), Susheel Aroskar, QCon New York 2018: the original talk on Zuul Push, the registry and the Kafka-based message flow.
- [Zuul wiki: Push Messaging](https://github.com/Netflix/zuul/wiki/Push-Messaging): the two-step lookup, what the global registry needs, load balancer advice for long-lived connections, and the TTL and reconnect dither settings.
- [Pushy to the Limit: Evolving Netflix's WebSocket proxy for the future](https://netflixtechblog.com/pushy-to-the-limit-evolving-netflixs-websocket-proxy-for-the-future-b468bc0ff658), Netflix Technology Blog, 2024: the same design years later, at hundreds of millions of connections.
- [The System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message queues and back pressure, the idea behind putting Kafka in front of the fleet.
- [The System Design Primer: Load balancer](https://github.com/donnemartin/system-design-primer#load-balancer): layer 4 versus layer 7 load balancing, relevant for long-lived WebSocket connections.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its "Distributed Messaging, Queuing, and Event Streaming" section lists the Netflix push talk next to many other company case studies.
- *System Design Interview – An Insider's Guide*, Vol. 1 (Alex Xu): the chapters "Design A Notification System" and "Design A Chat System" cover push delivery and WebSocket connection servers.
