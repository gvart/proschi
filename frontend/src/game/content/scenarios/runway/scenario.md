---
title: Runway
summary: A trip-planning startup built for a boom that never came. Cut the cloud bill month by month without breaking what customers pay for.
difficulty: medium
tags: [cost, right-sizing, caching, availability-zones]
related: [url-shortener, search-autocomplete]
cards: [servers-for-peak-load, hit-rate-to-db-load, cache-aside, cdn-cache-control, surviving-a-zone, failover-timeout]
order: 8
version: 1
mode: cost
---

## Briefing

Wayfarer plans trips: search places, save them to a trip, open your trips on
the go. Last year's funding round came with a growth plan, and the
infrastructure was built for it: twelve app servers, three of everything
else, a CDN, a search cluster. The growth did not come. The cloud bill is
about $4 000 a month, revenue is about $1 500, and the bank account has
$5 000 in it.

Every month a ticket lands, mostly from Finance, which lowers the budget
step by step. The customers and the on-call still expect the product to
work, so the SLOs stay. Cut what nothing uses, size what is left for the
peak, and keep two of everything that must not fail.

## Ticket: runway

**From:** Hannah, CFO

Our cloud bill was $4 050 last month and revenue was $1 550. At that rate we
have two months left. I need the bill under **$3 600 a month** starting now,
and lower every month after that; I will tell you how much lower.

Start with the obvious one: the Elasticsearch cluster from the "Discover"
feature we shut down in March still costs $800 a month. As far as I can see,
nothing has queried it since.

Please don't make saving a trip slow while you are at it: that is the only
thing people pay for. It stays under 400 ms.

## Ticket: cdn-bill

**From:** Hannah, CFO

The CDN is $300 a month, three edge plans. I asked our contractor what it
caches, and he sent me this from its dashboard: **cache hit ratio 0.0%**.
Every response is per user (search results are ranked with your saved
places, and trips are yours), so it is marked `Cache-Control: private` and
every request goes through to us anyway.

Budget this month: **$3 000**.

## Ticket: idle-fleet

**From:** Hannah, CFO

Ops sent me the graphs: twelve app servers, and at the busiest hour of the
busiest day they were at 14% CPU. Two thirds of the bill is servers waiting.
Budget: **$2 300 a month**.

Also from support: search sometimes takes a quarter of a second at lunch.
Keep it under 250 ms while you trim.

## Ticket: sla

**From:** Tomás, head of IT at a travel agency with 60 branches

We would like to move our agents' trip planning to Wayfarer, about 400 seats.
We need it in the contract: saving a trip is **99.9%** available, and **no
single machine** failing takes you down. We have been burned by a startup
running on one server before.

PS from your on-call: the database primary's disk started throwing errors
this week. The vendor will fail it over to a replica.

## Ticket: redis

**From:** Hannah, CFO

The agency signed, thank you. Next: we pay $450 a month for Redis. Our
database already has every row in it; why do we pay twice to store the same
data? Budget: **$1 900 a month**.

(Note from Sam, backend: one place search reads 16 rows from the places
table. Redis answers about 9 searches in 10 without touching the database.)

## Ticket: summer

**From:** Ines, marketing

Summer is here and people plan holidays: we expect about 70% more searches
than in spring, with peaks at lunch and in the evening. If search gets slow
they plan on our competitor's site instead. Please keep it under 200 ms.

## Ticket: zone-drill

**From:** Kai, SRE

Our cloud provider announced power maintenance in one availability zone this
month, two hours, no exact time. Everything we run in that zone goes away
for the duration, about a third of every fleet. One-instance components in
that zone are simply gone. Traffic keeps growing too. Please make sure we
are still there when the lights come back.

## Interview translation

Cost is a requirement like latency: estimate the peak, size for it with
headroom, and pay for nothing else. Turn off what has no traffic. A CDN
only helps responses that can be cached and shared; with private, per-user
responses its hit ratio is zero and it is one more hop and one more bill.
App servers are stateless, so right-size them by count: enough that the
fleet sits well under its limit at the peak, and still holds when a zone
takes a third of it away.

A cache is not a duplicate of the database but a cheaper way to serve
reads: at a 90% hit ratio it takes nine reads in ten off the database, so
two small database replicas do the work of five. Never cut below two of
anything whose loss stops the product: a load balancer, an app tier, a
database with a replica to fail over to. The cheapest design is the
smallest one that still survives losing any one node, and a zone.
