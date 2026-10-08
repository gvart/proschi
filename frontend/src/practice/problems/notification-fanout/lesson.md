# Notification Fan-out: accept fast, deliver patiently

```tldr
The promise to the Order Service is **accepted, not sent**: one write to a **durable queue**, in milliseconds. **Workers** take events from the queue, **check preferences first**, send through one provider and **fail over** to a backup SMS provider. Delete only after the send; the event id is the **idempotency key**.
```

"Tell the customer their order shipped" sounds like one line of code: call the email API. Then the email provider has a bad afternoon, and every order update takes seconds or fails. Here you design a notification system that takes events from the Order Service in milliseconds, picks the right channel, respects opt-outs and survives a provider outage.

## What you'll learn

- Why slow, flaky third parties belong behind a queue, never on the caller's request path.
- What at-least-once delivery means for a worker, and how idempotency keys keep users from getting duplicates.
- How to route by user preferences, and why the preference check comes before any send.
- How to fail over between providers and how Proschi models that with a failed call and a fallback.
- How to estimate provider load per channel and check it against rate limits.

## The problem, explained

**Who uses it.** The Order Service, an internal caller, emits events like `OrderShipped` to be turned into an email, SMS or push notification, whichever the customer prefers.

**Functional requirements.**

- **Notify**: the Order Service hands over an event and gets an answer as soon as the event is safely accepted.
- **Deliver**: a queue hands an accepted event to a worker, which reads the user's preferences and sends at most one notification. Five scenarios: `"Email"`, `"Push"`, `"SMS"`, `"SMS failover"` (the SMS provider does not answer, the backup sends it) and `"Opted out"` (nothing is sent).

**Non-functional requirements.**

- Hand-over p99 under 50 ms (99% are faster); the Order Service never waits for a provider.
- Accepting events is 99.95% available.
- An accepted event is never lost, even if every provider is down for a while.
- Losing any single machine, or the SMS provider, does not stop notifications.
- At most $2,000 a month, including the given Order Service and Preferences service.

**What is given, and why.** `given.proschi` declares the caller (`orders`, four replicas), the existing Preferences service (`prefs`, three replicas) and four providers: `email`, `sms`, `smsBackup` and `push`. Their capacity limits (2k, 500, 500 and 10k requests a second) stand for real rate limits. They are external: free in the model, about 200 ms per call, 99.9% available.

**What the tests check.**

- *The Order Service never waits for a provider*: Notify never waits for an external system, writes a queue before answering, and `orders` has no connection to a provider.
- *Workers take events from the queue*: Deliver starts at a queue.
- *Preferences are checked before anything is sent*: Deliver calls `prefs` before any provider, and the opted-out scenario never calls a provider.
- *Each channel goes out through its provider*: Email calls `email`, Push calls `push`, SMS calls `sms`.
- *SMS fails over to the backup provider*: Deliver survives a failed call to `sms`, and the failover scenario calls `smsBackup` after `sms`.

## Back-of-the-envelope

```numbers
1,500/s | events at peak, accepted and delivered once
825 rps | email sends, about 40% of the 2k limit
≈ 300 | provider calls in flight
900,000 | events queued after a 10-minute total outage
$700 | of the $2,000 already spent
```

Peak is 1,500 events a second, each accepted and delivered once, split 55% email, 30% push, 11% SMS (10% by the primary, 1% failing over to the backup) and 4% opted out.

| Quantity | Arithmetic | Result |
|---|---|---|
| Queue writes (Notify) | 1,500 events/s | 1,500 rps |
| Preference lookups | every delivered event | 1,500 rps |
| Email sends | 55% × 1,500 | 825 rps (limit 2k) |
| Push sends | 30% × 1,500 | 450 rps (limit 10k) |
| SMS sends | 10% × 1,500 | 150 rps, plus 15 calls that time out (limit 500) |
| SMS failover: backup sends | 1% × 1,500 | 15 rps (limit 500) |
| Opted out: nothing sent | 4% × 1,500 | 60 events/s |
| Provider calls in flight | 1,500/s × ~0.2 s (Little's law) | about 300 at once |
| Backlog if all providers are down for 10 minutes | 1,500/s × 600 s | 900,000 events |

**Rate limits.** Every channel is under its provider's limit at peak; email is the closest, at about 40%. If the Order Service also called a provider inline, that load would come on top and could push email over its limit.

**Concurrency.** *Little's law*: requests in flight = arrival rate × time in the system. With 200 ms provider calls, workers hold about 300 calls open, so they need asynchronous I/O or a big enough pool. Proschi does not model a worker waiting on a slow dependency (a service replica is one server with a 10 ms service time): point this out yourself.

```quiz
littles-law-concurrency
```

**Backlog.** A ten-minute outage of everything leaves under a million small messages queued. Queues keep messages for days (SQS for up to 14), so "never lose an accepted event" comes from the queue, not from heroics in the workers.

**Sizing the parts you add.** A queue replica takes 50k writes a second, so two are lightly loaded and redundant. A service replica takes 2k requests a second against the worker's 1,500 events a second: divide by your target utilisation, and stay under 100% with one replica lost.

**Latency in the model.** Notify is the Order Service writing the queue, a 5 ms hop: lots of room under 50 ms, unless a provider is on the path, since one call is already 200 ms.

```deepdive Why a provider's tail must stay off the caller's path
Deliver has no latency requirement; the providers decide its p99. A provider is a single server in the model, so at 41% busy the email provider takes around 340 ms on average because of queueing: exactly the slow tail you keep off your caller's path.
```

**Availability.** Notify's is the queue's, and two replicas of a 99.99% queue are effectively always up in the model. Deliver's is capped by the providers (99.9% each), which is fine: the queue holds events until delivered.

**Cost.** The given services cost $700 a month ($100 per service replica); a queue replica is $200. There is room for a sensible design, not for doubling every tier.

## Concepts

### Queue-based load levelling

Put a durable queue between a fast caller and slow work. The caller's request ends when the queue stores the message; workers drain it at the pace the providers allow. The queue absorbs bursts (*load levelling*) and outages (*buffering*).

```callout takeaway
The queue is a simple, highly available system whose only job is to accept and hold messages. Its availability and latency are far better than any provider's, so **the caller inherits the queue's, not the provider's**.
```

Trade-offs: delivery is asynchronous, so the caller only knows the email will be attempted, and you must monitor queue depth and message age. When not to use it: when the caller truly needs the result now. (A one-time password the user awaits may still go through a queue, with a priority lane and tight alerting.)

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

```callout pitfall The second use case starts at the queue
In Proschi a request to a queue always counts as a write, so a worker that "polls" looks like write load, and its flow starts at the worker. Real SQS consumers do long-poll; the model's convention is that the queue hands the message over, as an SQS-triggered Lambda or a push subscription would.
```

```quiz
queue-load-levelling
beat-your-dependency
```

### At-least-once delivery and idempotency keys

Queues like SQS deliver *at least once*. A message is hidden for a *visibility timeout* while a worker handles it, and deleted only when the worker says so; if the worker crashes, it reappears for another worker. Occasionally a message arrives twice even without a crash, so the SQS documentation says to make consumers *idempotent* (safe to run twice).

Here a duplicate means a customer gets the same text twice. The defence is an *idempotency key*: a unique id (the event id) that the worker passes to the provider or records itself, so a repeated send does nothing. Stripe's write-up on idempotency explains the pattern for APIs in general.

Someone must store the keys for a while: the provider, if it accepts idempotency keys, or a small table or cache of recently sent event ids.

### Provider failover and circuit breakers

A third party will fail. For channels with alternatives (SMS has many vendors), the worker tries the primary and, on a timeout or error, sends through a backup. A *circuit breaker* makes this cheap: after enough failures it skips the primary for a while, so you do not pay a timeout on every message.

In Proschi a failed call is `-x`: a timeout (1,000 ms by default) and no answer. A scenario that calls a node with `-x` and still succeeds through another node is a *fallback*, what `survive failure of …` and `handles failure of …` look for.

````deepdive In Proschi: two providers
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
````

Do not fail over when both providers could act (a payment captured twice) or when the backup is much worse than a short delay: retry later from the queue instead.

```quiz
circuit-breaker
delayed-retries
```

## Designing it step by step

**1. Scope.** Clarify the channels (email, SMS, push), who picks one (the user's preferences), whether one event can produce several notifications (no, at most one), the peak rate, and the promise to the caller ("accepted" means stored, not sent). Ask about opt-outs: for legal and ethical reasons, they are honoured before anything goes out.

**2. High-level design.** Two flows, one boundary between them:

- *Notify*: Order Service → queue → `200`. Nothing else on that path.
- *Deliver*: queue → worker → Preferences → one provider → delete the message.

Name and reject the alternative, the Order Service calling providers itself: it couples order processing to the worst provider's latency and availability, which the requirements forbid.

**3. Deep dive.**

- *Scenarios.* The preference answer decides the branch: one per channel, a failover branch where the SMS call fails with `-x` and the backup is called, and an opted-out branch that only deletes the message. Spell the names exactly as the problem does; the traffic mix refers to them.
- *Ordering of steps.* Preferences, then provider. Delete the message only after the provider accepted it (or after deciding not to send), so a crash causes a retry, not a loss.
- *Sizing.* Two queue replicas, and enough workers for 1,500 events a second at well under 70%, still fine with one lost. Nothing needs to be big; $700 of the $2,000 is already spent.
- *Duplicates.* Use the event id as the provider's idempotency key; mention it though the model does not simulate redelivery.

**4. Wrap-up.** Check: Notify is one queue write; no path from the Order Service to a provider; the failover scenario covers an SMS outage; every node you run has two or more replicas; the bill fits. Then extend: priority queues for urgent messages, per-user rate limits so nobody gets twenty texts in a minute, a dead-letter queue for events that keep failing, and provider delivery receipts to track what arrived.

## Common mistakes

**A notifier that queues and then sends inline** (`wrong/notifier-calls-provider-inline`). The notifier writes the queue, then calls the email provider before answering. The caller still waits for a 200 ms third party, and every provider outage becomes an order-processing outage. In the model it is worse: the inline sends come on top of the worker's, the email provider goes over its 2k rps limit, and Notify's p99 runs to many seconds. It fails *The Order Service never waits for a provider*, and also Notify's p99 and availability limits.

**A worker that polls the queue** (`wrong/worker-polls-queue`). Deliver starts with the worker sending `ReceiveMessage` to the queue. Common with SQS, but in this model it reads as the worker writing to the queue, and the flow no longer starts at the queue. It fails *Workers take events from the queue*. Model the queue handing the event over instead.

**Other classic mistakes.**

- *Checking preferences after sending*, or not at all for one channel. An opted-out user gets a message. Fails *Preferences are checked before anything is sent*.
- *Only retrying the primary SMS provider.* Every SMS waits out the outage, and with no fallback `survive failure of sms` fails.
- *Deleting the message before the send.* If the worker dies right after, the notification is lost: at-most-once by accident.
- *One queue replica or one worker.* A single point of failure; fails `survive any node failure`.
- *One giant queue for every priority.* A marketing blast of millions delays password resets: separate queues (or priorities) per class of message.

## In the interview

Give the core idea, draw the queue as the boundary, then walk one event through each scenario.

```callout interview The one-sentence pitch
"The caller's promise is *accepted*, not *sent*; a durable queue makes that promise cheap and keeps third parties off the request path."
```

Follow-ups you should expect:

- *How do you avoid sending twice?* At-least-once plus idempotency: the event id is the key, sent to the provider or checked in a small store of recently sent ids.
- *A provider is down for an hour?* Messages stay queued (or are retried with backoff), a circuit breaker switches to the backup where one exists, and queue age alerts fire. Nothing is lost.
- *Provider rate limits?* Limit worker concurrency per provider, or a token bucket per provider in the workers.
- *Templates and localisation?* A template service the worker calls after preferences, keyed by event type and locale, heavily cached.
- *How do you know it was delivered?* Provider callbacks (delivery receipts) written to a status store; for push, the app can acknowledge on display.
- *Bulk campaigns?* A separate pipeline and queue, never competing with transactional messages.

## Further reading

- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message queues, task queues and back pressure, with the note that SQS can deliver twice.
- [Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html), Amazon SQS Developer Guide: why a message can arrive more than once and why consumers must be idempotent.
- [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency), Stripe: idempotency keys and safe retries.
- [Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html), Martin Fowler: stop calling a failing dependency and fail fast instead.
- [Rapid Event Notification System at Netflix](https://netflixtechblog.com/rapid-event-notification-system-at-netflix-6deb1d2b57d1), Netflix Technology Blog, 2022: priority-specific SQS queues and push to online devices at scale.
- [awesome-system-design-resources](https://github.com/ashishps1/awesome-system-design-resources): includes "Design Notification Service" among its medium interview problems.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Notification System".
