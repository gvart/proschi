# Notification Fan-out: accept fast, deliver patiently

"Tell the customer their order shipped" sounds like one line of code: call the email API. Then the email provider has a bad afternoon, every order update starts taking seconds, and some of them fail. This lesson designs a notification system that the Order Service can hand events to in a few milliseconds, which then picks the right channel, respects opt-outs and survives a provider outage.

## What you'll learn

- Why slow, flaky third parties belong behind a queue, never on the caller's request path.
- What at-least-once delivery means for a worker, and how idempotency keys keep users from getting duplicates.
- How to route by user preferences, and why the preference check comes before any send.
- How to fail over between providers and how Proschi models that with a failed call and a fallback.
- How to estimate provider load per channel and check it against rate limits.

## The problem, explained

**Who uses it.** The Order Service, an internal caller. It emits events like `OrderShipped` and wants them turned into an email, SMS or push notification, whichever the customer prefers.

**Functional requirements.**

- **Notify**: the Order Service hands over an event and gets an answer as soon as the event is safely accepted.
- **Deliver**: a queue hands an accepted event to a worker. The worker reads the user's preferences and sends at most one notification. Five scenarios: `"Email"`, `"Push"`, `"SMS"`, `"SMS failover"` (the SMS provider does not answer, the backup sends it) and `"Opted out"` (nothing is sent).

**Non-functional requirements.** Handing over an event takes under 50 ms at p99, and the Order Service never waits for a provider. Accepting events is available 99.95% of the time. An accepted event is never lost, even if every provider is down for a while. Losing any single machine, or the SMS provider, must not stop notifications. At most $2,000 a month, including the given Order Service and Preferences service.

**What is given, and why.** `given.proschi` declares the caller (`orders`, four replicas), the existing Preferences service (`prefs`, three replicas) and four providers: `email`, `sms`, `smsBackup` and `push`. The providers carry capacity limits (2k, 500, 500 and 10k requests a second) because real providers rate-limit you. They are external systems: you do not run them, they cost nothing in the model, and they answer in about 200 ms with 99.9% availability.

**What the tests check.**

- *The Order Service never waits for a provider*: Notify never waits for an external system, writes a queue before answering, and there is no connection at all from `orders` to a provider.
- *Workers take events from the queue*: Deliver starts at a queue.
- *Preferences are checked before anything is sent*: Deliver calls `prefs` before any provider, and the opted-out scenario never calls a provider.
- *Each channel goes out through its provider*: Email calls `email`, Push calls `push`, SMS calls `sms`.
- *SMS fails over to the backup provider*: Deliver survives a failed call to `sms`, and the failover scenario calls `smsBackup` after `sms`.

## Back-of-the-envelope

Peak is 1,500 events a second, each accepted once and delivered once. The channel mix splits that load.

| Quantity | Arithmetic | Result |
|---|---|---|
| Queue writes (Notify) | 1,500 events/s | 1,500 rps |
| Preference lookups | every delivered event | 1,500 rps |
| Email sends | 55% × 1,500 | 825 rps (limit 2k) |
| Push sends | 30% × 1,500 | 450 rps (limit 10k) |
| SMS sends | 10% × 1,500 | 150 rps (limit 500) |
| SMS failover: backup sends | 1% × 1,500 | 15 rps (limit 500) |
| Opted out: nothing sent | 4% × 1,500 | 60 events/s |
| Provider calls in flight | 1,500/s × ~0.2 s (Little's law) | about 300 at once |
| Backlog if all providers are down for 10 minutes | 1,500/s × 600 s | 900,000 events |

**Rate limits.** Every channel is under its provider's limit at peak, email the closest at about 40%. That matters: if the Order Service also called a provider inline, the email provider would see that load on top and could go over.

**Concurrency.** *Little's law* says the number of requests in flight equals arrival rate times time in the system. With 200 ms provider calls, workers hold about 300 calls open at once. Real workers need asynchronous I/O or a big enough pool. Proschi does not model a worker waiting on a slow dependency (a service replica is one server with a 10 ms service time), so this one is yours to say out loud.

**Backlog.** A ten-minute outage of everything leaves under a million small messages in the queue. Queues measure retention in days, so "never lose an accepted event" is a property you get from the queue, not from heroics in the workers.

**Sizing the parts you add.** A queue node takes 50k writes a second per replica, so two are lightly loaded and give redundancy. A service replica takes 2k requests a second; the worker receives 1,500 events a second. Divide by your target utilisation, then make sure the tier stays under 100% with one replica lost.

**Latency in the model.** Notify's path is the Order Service writing the queue, a 5 ms hop. The 50 ms limit leaves lots of room, unless a provider is on the path: one provider call is already 200 ms. Deliver has no latency requirement, and its p99 is dominated by providers. In the model a provider is a single server, so at 41% busy the email provider queues to around 340 ms on average: a nice illustration of why you never want a third party's tail on your user's path.

**Availability.** Notify's availability is the queue's, and two replicas of a 99.99% queue are effectively always up in the model. Deliver's availability is capped by the providers (99.9% each); that is fine, because the queue holds events until they are delivered.

**Cost.** The given services cost $700 a month ($100 per service replica). A queue replica is $200. The budget leaves room for a sensible design, not for doubling every tier.

## Concepts

### Queue-based load levelling

Put a durable queue between a fast caller and slow work. The caller's request ends when the queue stores the message; workers drain the queue at the pace the providers allow. The queue absorbs bursts (*load levelling*) and outages (*buffering*).

Why it works: the queue is a simple, highly available system whose only job is to accept and hold messages. Its availability and latency are much better than any provider's, so the caller inherits those, not the provider's.

Trade-offs: delivery becomes asynchronous, so the caller cannot know whether the email was sent, only that it will be attempted. You need monitoring for queue depth and age. When not to use it: when the caller truly needs the result now (a one-time password the user is waiting for may still go through a queue, but with a priority lane and tight alerting).

```proschi
title "Accept now, work later"

caller "Caller"   [REST API]        x2
inbox  "Inbox"    [AWS SQS]         x2
worker "Worker"   [Worker]          x2
slow   "Slow API" [Third Party API]

caller -> inbox  : SendMessage
inbox  -> worker : deliver
worker -> slow   : call

usecase "Accept" {
  caller -> inbox  : SEND ReportRequested {"id": 7}
  inbox --> caller : 200 queued
}

usecase "Work" {
  inbox   -> worker : ReportRequested {"id": 7}
  worker  -> slow   : POST /render
  slow   --> worker : 200
  worker --> inbox  : delete
}
```

Note the shape: the second use case *starts at the queue*. In Proschi a request to a queue always counts as a write, so a worker that "polls" with a request would look like write load on the queue and its flow would start at the worker. Real SQS consumers do long-poll; the model's convention is that the queue hands the message over, as an SQS-triggered Lambda or a push subscription would.

### At-least-once delivery and idempotency keys

Queues like SQS deliver *at least once*: a message stays in the queue, hidden for a *visibility timeout* while a worker handles it, and is deleted only when the worker says so. If the worker crashes, the message reappears and another worker takes it. Occasionally a message is delivered twice even without a crash; the SQS documentation tells you to make consumers idempotent.

For notifications, a duplicate means a customer gets the same text twice. The standard defence is an *idempotency key*: a unique id (the event id) that the worker passes to the provider or records itself, so a repeated send with the same key does nothing. Stripe's write-up on idempotency explains the pattern for APIs in general.

Trade-off: someone must store the keys for a while. Providers that accept an idempotency key do it for you; otherwise a small table or cache of recently sent event ids does it.

### Provider failover and circuit breakers

A third party will fail. For channels with alternatives (SMS has many vendors), the worker tries the primary and, on a timeout or error, sends through a backup. A *circuit breaker* makes this cheap: after enough failures it stops calling the primary for a while and goes straight to the backup, instead of paying a timeout on every message.

In Proschi, a failed call is `-x`, which costs a timeout (1,000 ms by default) and gets no answer. A scenario that calls a node with `-x` and still succeeds through another node is a *fallback*, which is what `survive failure of …` and `handles failure of …` look for:

```proschi
title "Two providers"

jobs    "Address Events"  [AWS SQS]         x2
app     "App"             [Worker]          x2
primary "Geocoder"        [Third Party API]
backup  "Backup Geocoder" [Third Party API]

jobs -> app     : deliver
app  -> primary : lookup
app  -> backup  : lookup

usecase "Geocode" {
  jobs -> app : AddressAdded
  alt "Primary" {
    app      -> primary : GET /geocode
    primary --> app     : 200
  } alt "Failover" when "the primary times out" {
    app     -x primary : GET /geocode
    app     -> backup  : GET /geocode
    backup --> app     : 200
  }
}
```

When not to fail over: when the two providers would both act (a payment captured twice), or when the backup is much worse and a short delay would be better. Then retrying later from the queue is the safer choice.

## Designing it step by step

**1. Scope.** Clarify: which channels (email, SMS, push), who decides the channel (the user's preferences), whether one event can produce several notifications (no, at most one), the peak rate, and the promise to the caller ("accepted" means stored, not sent). Ask about opt-outs: legally and ethically they must be honoured before anything goes out.

**2. High-level design.** Two flows, one boundary between them:

- *Notify*: Order Service → queue → `200`. Nothing else on that path.
- *Deliver*: queue → worker → Preferences → one provider → delete the message.

Name the alternative and reject it: the Order Service calling providers itself. It couples order processing to the worst provider's latency and availability, and the requirement says the Order Service must never wait for one.

**3. Deep dive.**

- *Scenarios.* The preference answer decides the branch. Write one branch per channel, a failover branch where the SMS call fails with `-x` and the backup is called, and an opted-out branch that only deletes the message. Spell the scenario names exactly as the problem does; the traffic mix refers to them.
- *Ordering of steps.* Preferences first, provider second. Delete the message only after the provider accepted it (or after deciding not to send), so a crash in between causes a retry, not a loss.
- *Sizing.* Two queue replicas, and enough worker replicas for 1,500 events a second at well under 70%, still fine with one lost. Nothing you add needs to be big; the budget is $2,000 with $700 already spent.
- *Duplicates.* Use the event id as an idempotency key with the provider. Mention it even though the model does not simulate redelivery.

**4. Wrap-up.** Check: Notify is one queue write; no path from the Order Service to a provider; the SMS outage is covered by the failover scenario; every node you run has two or more replicas; the bill fits. Then extend: priority queues for urgent messages, per-user rate limits so nobody gets twenty texts in a minute, a dead-letter queue for events that keep failing, and delivery receipts from providers to track what actually arrived.

## Common mistakes

**A notifier that queues and then sends inline** (`wrong/notifier-calls-provider-inline`). The Order Service calls a notifier, which writes the queue and then calls the email provider before answering. The queue is there, but the caller still waits for a 200 ms third party, and every provider outage becomes an order-processing outage. In the model it is worse: the email provider now gets the inline sends on top of the worker's, goes over its 2k rps limit, and Notify's p99 runs to many seconds. It fails *The Order Service never waits for a provider*.

**A worker that polls the queue** (`wrong/worker-polls-queue`). The Deliver flow starts with the worker sending `ReceiveMessage` to the queue. That is how SQS consumers are often written, but in this model it reads as the worker writing to the queue, and the flow no longer starts at the queue. It fails *Workers take events from the queue*. Model the queue handing the event over instead.

**Other classic mistakes.**

- *Checking preferences after sending*, or not at all for one channel. An opted-out user gets a message. Fails *Preferences are checked before anything is sent*.
- *Only retrying the primary SMS provider.* During an outage every SMS waits, and with a single external node and no fallback, `survive failure of sms` fails.
- *Deleting the message before the send.* If the worker dies right after, the notification is lost: at-most-once by accident.
- *One queue replica or one worker.* A single point of failure; fails `survive any node failure`.
- *One giant queue for every priority.* A marketing blast of millions delays password resets. Separate queues (or priorities) per class of message.

## In the interview

Say the core idea in one sentence: "The caller's promise is *accepted*, not *sent*; a durable queue makes that promise cheap and keeps third parties off the request path." Draw the queue as the boundary, then walk through one event per scenario.

Follow-ups you should expect:

- *How do you avoid sending twice?* At-least-once plus idempotency: the event id is the key, sent to the provider or checked in a small store of recently sent ids.
- *A provider is down for an hour. What happens?* Messages stay in the queue (or are retried with backoff); a circuit breaker switches to the backup where one exists; queue age alerts fire. Nothing is lost.
- *How do you respect provider rate limits?* Limit worker concurrency per provider, or use a token bucket per provider in the workers.
- *How would you add templates and localisation?* A template service the worker calls after preferences, keyed by event type and locale; cache it heavily.
- *How do you know a message was delivered?* Provider callbacks (delivery receipts) written to a status store; for push, the app can acknowledge when it displays the notification.
- *What about bulk campaigns?* A separate pipeline and queue so they never compete with transactional messages.

## Further reading

- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message queues, task queues and back pressure, with the note that SQS can deliver twice.
- [Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html), Amazon SQS Developer Guide: why a message can arrive more than once and why consumers must be idempotent.
- [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency), Stripe: idempotency keys and safe retries.
- [Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html), Martin Fowler: stop calling a failing dependency and fail fast instead.
- [Rapid Event Notification System at Netflix](https://netflixtechblog.com/rapid-event-notification-system-at-netflix-6deb1d2b57d1), Netflix Technology Blog, 2022: priority-specific SQS queues and push to online devices at scale.
- [awesome-system-design-resources](https://github.com/ashishps1/awesome-system-design-resources): includes "Design Notification Service" among its medium interview problems.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Notification System".
