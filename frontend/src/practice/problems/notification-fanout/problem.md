---
title: Notification Fan-out
summary: Queue it, check preferences, fail over between providers.
difficulty: medium
tags: [queues, async, external-providers, failover]
hints:
  - Providers take 200 ms and have outages, but the Order Service needs an answer in under 50 ms. What can accept the event right away and keep it until it is sent?
  - "Split the work in two: \"Notify\" only puts the event on a queue; \"Deliver\" starts with the queue handing the event to a worker (events -> worker), which deletes it once it is handled."
  - In "Deliver", ask the Preferences service before calling any provider, so an opted-out user is never contacted.
  - Model the SMS outage with a failed call (-x sms) followed by a call to smsBackup in the "SMS failover" scenario.
---

The Order Service wants to tell customers when their order ships,
is delayed or arrives. Build the notification system it hands these events
to: it picks the channel each customer wants and sends the message through
an external email, SMS or push provider.

## Functional requirements

- **Notify**: the Order Service hands an event (`OrderShipped`, …) for a
  user over and gets an answer as soon as the event is safely accepted.
- **Deliver**: a queue hands an accepted event to a worker (the use case
  starts with a step sent by the queue). The user's preferences decide the
  channel; each event becomes at most one notification. Model five
  scenarios:
  - `"Email"`, `"Push"`, `"SMS"`: the user prefers that channel and the
    notification goes out through its provider.
  - `"SMS failover"`: the SMS provider does not answer; the message goes
    out through the backup SMS provider instead.
  - `"Opted out"`: the user turned these notifications off; nothing is
    sent.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **1,500 events per second** at peak (evening delivery rounds), each one
  handed over once and delivered once.
- 55% of users prefer email, 30% push, 10% SMS; 4% opted out. The SMS
  provider times out on about 1% of all events.
- Providers are slow and flaky: about **200 ms** per call when they work,
  and they have outages.

## Constraints

- The Order Service must never wait for a provider: handing over an event
  takes under **50 ms** at p99.
- Accepting events available **99.95%** of the time.
- An accepted event is never lost, even if every provider is down for a
  while.
- Losing any single machine, or the SMS provider, must not stop
  notifications.
- At most **$2,000 / month**, the Order Service and the Preferences service
  included.

## What is given

`problem.proschi` declares the `orders` service (the caller), the existing
`prefs` service (each user's channel and opt-outs) and the providers
`email`, `sms`, `smsBackup` and `push`, with their rate limits. It also
holds the traffic, requirements and tests. Add the components, the
connections and the two use cases.
