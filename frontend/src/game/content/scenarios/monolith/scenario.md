---
title: Monolith
summary: A ten-year-old shop on one app and one database. Strangle it endpoint by endpoint behind a gateway, split the orders table live, and never go down.
difficulty: hard
tags: [legacy, strangler-fig, migrations, api-versioning, zero-downtime]
related: [shopping-cart, flash-sale, rate-limiter]
cards: [api-gateway-scope, bulkheads, expand-contract-migration, online-backfill, replicas-do-not-scale-writes, breaking-change, cache-aside, token-bucket]
order: 7
version: 1
mode: legacy
---

## Briefing

Trailhead sells outdoor gear, and has since 2016, from one Rails app and one
Postgres database. The app is called `mono` and it does everything: product
pages, search, carts, checkout, and an XML order export that three wholesale
partners have scraped every night for eight years. It runs fine on a quiet
Tuesday. It does not run fine on a sale day, and every team ships through one
release train that leaves once a month.

Nobody gets to rewrite it. You get to strangle it: put a gateway in front,
move one endpoint at a time to a smaller service, move one table at a time to
its own database, and turn things off only once nobody calls them. Every
ticket below must ship without downtime. Checkout is where the money is, and
it does not go down.

## Ticket: release-train

**From:** Dana, CTO

Twelve teams, one deploy a month, and a 400-line release checklist. Last
month a typo in the newsletter template rolled back the checkout fix with it.

I am not approving a rewrite: the last company I was at spent two years on one
and shipped nothing. What I want is a seam. Put an API gateway in front of
`mono`, so that we can send one path at a time to something new and send it
back if it breaks. Checkout stays at 99.9% while you do it, and under 300 ms.

## Ticket: sale-day

**From:** Tomás, SRE on call

Post-mortem from Saturday's spring sale: at 10:00 the newsletter went out,
search traffic went up four times, and search queries pinned every `mono`
worker. Checkout shares those workers, so checkout timed out too. We lost
about $38 000 in orders in 40 minutes because people could not *search*.

Search is almost a third of our requests and almost none of our revenue, and it should
not be able to take checkout down with it. Next sale is this month. Search
must stay under 200 ms at p99 and 99.5% available, through the peak.

## Ticket: orders-table

**From:** Kerstin, DBA

The `orders` table is 1.4 TB, 310 million rows, and it shares a primary with
everything else. Every write in this company, carts included, goes through
that one primary, and read replicas do not change that. On sale days write
latency is the first thing to go.

I want orders in their own database, owned by an orders service. But we do
this properly: no `pg_dump` at midnight, no "maintenance window". Create the
new schema, write to both, backfill in batches of 5 000, switch reads, and
drop the old table only when nothing reads it. One step per deploy, and every
step can be rolled back until the last. Start this month: the partners were
promised a JSON orders API, and it reads the new schema. Also: carts are
99.9% from now on.

## Ticket: catalog-v2

**From:** Amira, mobile team lead

The app's product list calls `/api/products.json`, which returns 380 KB of
fields we don't use and can't page. We need a catalog API v2: cursor
pagination, 20 items, about 4 KB. We ship the new app version on the 14th.

Please don't put it in `mono`. If it goes on the monolith release train we
ship in March. It needs p99 under 200 ms from our side and 99.9%
availability, or the app store reviews will tell us.

## Ticket: scrapers

**From:** Tomás, SRE on call

A price-comparison site has started scraping us: random product ids, random
search terms, about twice our real traffic, from a few thousand IPs. None of
it hits the cache, and all of it reaches our app servers and Postgres. Search has to be
99.9% available now (marketing promised it in the app), scrapers or not.
Rate-limit them at the edge.

## Ticket: orders-api

**From:** Bergwerk Outdoor, wholesale partner

We were told in spring that the XML export is going away and that there will
be a JSON orders API with paging. We would like to switch this month, before
our own peak season. Please confirm it will be 99.9% available: our
warehouse picks from it.

(Note from Dana: checkout goes to 99.95% this month. The board asked.)

## Ticket: black-friday

**From:** Lena, marketing

Black Friday is a week now, not a day: the deals open Monday and get better
every day until Friday. Last year carts went to four times a normal week and
checkouts with them, and people browse less: they know what they want. The
TV spot runs Thursday night.

(From Tomás: and nothing may depend on a single machine. If one box dies on
Friday at 08:05, I want to sleep through it.)

## Ticket: xml-export

**From:** Marco, finance

We pay about $500 a month to keep the XML order export alive: the on-call
runbook, the nightly test, the special-cased auth in `mono`. As of this
month, all three partners have moved to the JSON API and the export gets no
traffic at all. Please turn it off, and while you are at it, the DBA says the
old orders table can go. Our cloud budget for the platform is now $4 500 a
month.

## Interview translation

Never big-bang a rewrite of a system that earns money. Strangle it: put an API
gateway (or a routing layer) in front of the monolith, so every path can be
sent to the old code or to a new service, and moved back if it breaks. Move
one use case at a time, starting with the one that hurts most: here search,
the hot path, which got its own service and a cache, so a sale-day spike
scales a cheap search fleet and cannot starve checkout (a bulkhead). New
endpoints, like the mobile catalog API, are built outside the monolith from
day one. The gateway also rate-limits bots before they cost an app server or a
database read.

A shared database is the last thing to split. Moving a table to a service's
own database is an expand and contract migration: create the new schema,
dual-write, backfill in batches, cut reads and writes over to the new owner,
and drop the old table only when its last reader is gone. Each step is its
own deploy and can be rolled back until the drop. Splitting the writes over
two primaries is also what lets them survive the peak: read replicas never
add write capacity. Old endpoints stay up, at a cost, until their traffic is
gone: you deprecate, give clients a replacement and a deadline, watch the
traffic fall to zero, and only then sunset.
