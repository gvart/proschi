---
title: Ping
summary: A notification service. Answer at once, deliver soon, and never lose one.
difficulty: medium
tags: [queues, fan-out, async, resilience]
related: [notification-fanout]
cards: [queue-load-levelling, backlog-drain-time, workers-needed, at-least-once-needs-idempotency, fanout-write-vs-read]
order: 3
version: 1
---

## Briefing

Ping sends push notifications for other apps. A client posts a notification,
Ping stores it and hands it to a push provider, and users read their inbox.
The provider is someone else's system: usually quick, sometimes very slow,
never yours to scale. Answer the client fast, deliver within minutes, and
never drop a notification you accepted.

## Act 1

Launch. Calling the push provider while the client waits works until the
latency target tightens and the provider has a bad day.

## Act 2

Growth. Broadcasts fan out one request into forty pushes, and the freshness
target means a worker that keeps up on average is not enough.

## Act 3

Scale. Busy inboxes, a stricter availability target, and New Year's Eve.

## Debrief: async

The client does not need the push provider's answer, only your promise to
deliver. Store the notification, put a message on a durable queue and answer
202 at once; workers call the provider afterwards. The request now costs a
database write and a queue write, whatever the provider is doing.

## Debrief: backlog

A backlog grows by the difference between what arrives and what workers
finish, and drains only as fast as the spare capacity allows. Workers at
100% never catch up. Scale workers on the age of the oldest message, not on
CPU, and keep headroom for bursts.

## Interview translation

Accept, persist, enqueue, answer: the API writes the notification to a
durable store and a queue and returns 202, so its latency does not depend on
the provider. Workers consume the queue, call the provider with retries and
idempotency keys (delivery is at least once), and record deliveries in
batches. Fan-out happens in the workers, so a broadcast is one request and
many jobs. Size workers for the peak plus drain time, and alert on queue age.
