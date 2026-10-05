---
title: Pawprint
summary: A pet-sitter startup where the requirements never stop changing. Ship API v2 without breaking v1, and migrate the schema live.
difficulty: medium
tags: [startup, api-versioning, migrations, evolving-requirements]
related: [ticket-booking, job-queue, notification-fanout]
cards: [breaking-change, evolving-mobile-apis, expand-contract-migration, online-backfill, cache-aside, queue-load-levelling]
order: 5
version: 1
mode: startup
---

## Briefing

Pawprint matches pet owners with sitters nearby. You have one app server,
one Postgres box, an email provider, seed money, and a CTO who says yes to
everything. Every month a ticket lands in your inbox: a feature, a customer
complaint, a lawyer, a launch. Design for what is asked, keep what already
works working, and remember that the mobile apps out there cannot be updated
overnight.

## Ticket: mvp

**From:** Priya, product manager

We have sitters signed up in Berlin and owners asking where to book. For the
MVP: owners search sitters near a postcode and book one. Nothing fancy. A
booking must go through in well under a second, or people tap twice.

## Ticket: slow-search

**From:** support inbox, 14 tickets this week

> Search spins forever around noon. I gave up and called a friend instead.

Lunch and evening are our peaks. Search should come back in under 200 ms
even then.

## Ticket: mobile

**From:** Jonas, CTO

The iOS and Android apps ship Monday. They call the same booking API, and
they also show "My bookings" on the home screen, so that endpoint will be
hit on every app open. Bookings must stay up: 99.5% at least. Remember that
we cannot force people to update an app, so whatever API the apps call on
Monday, some phone will still call it a year from now.

## Ticket: multi-pet

**From:** Priya, product manager

Owners with two dogs book twice and pay twice the fee. We are fixing that:
a booking gets a list of pets instead of one `pet_id`. The new booking API
(v2) goes live in three waves; the old apps keep calling v1 until people
update.

The data team says: don't rename columns on a live table. Add the new
`booking_pets` table, write to both, backfill the old bookings, switch reads,
and only then drop `pet_id`. One step per deploy. Start this wave.

## Ticket: newsletter

**From:** Lea, marketing

The spring newsletter goes to 400 000 owners on Tuesday at 10:00. Expect a
spike of searches when it lands. Please don't fall over.

## Ticket: confirmations

**From:** legal@

Consumer law requires a written confirmation for every booking. Send the
email within 15 minutes, but do not make the owner wait for our email
provider to answer: it is slow on a good day. Booking p99 stays under
400 ms.

## Ticket: v2-launch

**From:** Priya, product manager

v2 is live in the new app version. Bookings for several pets go through the
new endpoint, and their confirmations too. About half the phones still run
the old app and call v1; that share will fall over the next months.

## Ticket: sla

**From:** a kennel chain with 40 locations

We will route our customers through Pawprint if bookings are 99.9%
available, contractually. And no single machine failing should take you
down: we have been burned before.

## Ticket: growth

**From:** Jonas, CTO

Search doubled in a month and the database is the hottest thing on our
dashboard. Most searches are for the same few postcodes. Get search p99 under
120 ms; we are losing owners to the competition.

## Ticket: two-apis

**From:** Marco, finance

We are paying people to keep two booking APIs alive, about $400 a wave in
on-call and testing. v1 traffic is almost gone. When can we turn it off?
(Support asks: please not while anyone still uses it.)

## Ticket: europe

**From:** Jonas, CTO

We launch in Amsterdam and Vienna. Our servers stay where they are, so
owners there are 120 ms away. Search must still answer in 300 ms at p99.

## Ticket: cleanup

**From:** Jonas, CTO

Before the audit: drop the old `pet_id` column. Only if nothing reads it any
more, please. Also, the database vendor will fail over the primary this
month for patching.

## Interview translation

Requirements change, so design for change. Search is read-heavy and shared,
so it sits behind a cache (and a CDN for far users), and app servers stay
stateless behind a load balancer. Side effects like confirmation emails go
through a queue and workers, so a slow provider never slows a booking.

Clients you do not control force backward compatibility: a breaking change
ships as a new version (v2) next to the old one, and v1 is sunset only when
its traffic is gone. The schema behind it changes by expand and contract:
add the new table, dual-write, backfill in batches, switch reads, and drop
the old column only after its last reader is gone. Each step is its own
deploy and can be rolled back until the drop.
