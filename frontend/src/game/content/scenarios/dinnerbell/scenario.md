---
title: Dinnerbell
summary: You hold the pager for a food-delivery app. Read the alert, name the cause, fix it, and write it up.
difficulty: medium
tags: [on-call, incidents, resilience]
related: [notification-fanout, flash-sale]
cards: [cache-stampede, cold-cache-restart, surviving-a-zone, correlated-failures, load-shedding, availability-in-series]
order: 6
version: 1
mode: incident
---

## Briefing

Dinnerbell takes food orders in three cities. Menus come from a cache in
front of Postgres, orders are written to Postgres, and a worker sends the
"your food is on its way" push through a queue. Tonight you are on call.
Every page starts the same way: read the alert and the logs, name the root
cause before you touch anything, then change the system so it holds. A
wrong guess costs time, and time costs Trust.

## Ticket: tv-ad

**PagerDuty, 19:02**: `menu-latency-p99 > 300ms` (firing for 4 min)

```text
19:00:12 lb      requests/s 1 310 -> 2 640
19:01:40 api-1   cpu 99%  worker pool exhausted, queueing
19:01:41 api-2   cpu 100% worker pool exhausted, queueing
19:01:44 db      cpu 41%  connections 120/400  slow queries: 0
19:02:03 deploy  last deploy 14:10 (menu-service v2.31), no errors since
```

Marketing, in the incident channel: "our TV ad aired at 19:00, is that bad?"

## Ticket: primary-down

**PagerDuty, 21:15**: `order-error-rate > 5%`

```text
21:14:58 db-1    host unreachable (EC2 instance retirement)
21:15:02 api-*   ERROR could not connect to db-1:5432
21:15:02 cache   hit ratio 0.86, latency 1 ms
21:15:03 queue   depth 12, normal
21:15:10 menus   200 OK; orders 500
```

There is one database server. Its backups are from last night.

## Ticket: bots

**PagerDuty, 12:30**: `menu-latency-p99 > 300ms`

```text
12:28  lb      requests/s 1 600 -> 4 900
12:28  lb      top client IPs: 3 214 distinct, 61% of requests
12:29  cache   hit ratio 0.85 -> 0.31  (keys: /restaurants/{random}/menu)
12:29  orders  per minute: 4 800 (flat)
12:30  ua      "python-requests/2.31" 58%
```

## Ticket: cold-cache

**PagerDuty, 18:56**: `db-cpu > 95%`

```text
18:55:00 change  cache cluster upgraded (redis 7.0 -> 7.2), rolling restart
18:55:40 cache   keys 0, hit ratio 0.02
18:56:02 db      cpu 100%, reads/s 2 900 -> 12 400
18:56:10 api-*   p99 2 400 ms, timeouts to db
```

Nothing else changed today.

## Ticket: zone

**PagerDuty, 03:12**: `AWS Health: increased error rates in eu-west-1b`

```text
03:11 aws     eu-west-1b: power event, instances impaired
03:12 lb      targets healthy: api 4/6 (zone b drained)
03:12 cache   cache-1 (eu-west-1b) unreachable
03:12 queue   queue-1 (eu-west-1b) unreachable
```

When this is over, the CTO wants a postmortem: what was single, and what
is two of everything going to cost?

## Interview translation

Incidents are found by reading signals, not by guessing: a spike shows as
more requests and full app servers; a dead primary as connection errors
while reads still work; bots as many IPs, random keys and flat conversions;
a cold cache as a hit ratio near zero and the database on fire; a zone loss
as everything single in that zone gone at once. The fixes follow: scale the
stateless tier, run a replica to fail over to, filter at the edge, keep
read capacity for a cold cache, and run two or three of everything across
zones. Name the cause first, mitigate, then fix for good, and write the
postmortem without blame.
