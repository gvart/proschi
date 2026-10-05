---
title: Shortly
summary: A URL shortener goes viral. Keep redirects fast while traffic grows 70 times.
difficulty: easy
tags: [caching, read-heavy, availability]
related: [url-shortener]
cards: [cache-aside, hit-rate-to-db-load, surviving-a-zone, servers-for-peak-load, replicas-do-not-scale-writes]
order: 1
version: 1
---

## Briefing

You and a co-founder launch Shortly from one app server and one Postgres box.
People shorten a link once and open it a hundred times, so almost all of your
traffic is redirects: a lookup by code and a 302. Keep them fast and keep
them up while traffic grows from a few hundred requests a second to tens of
thousands.

## Act 1

The garage. Learn to scale out: one app server takes about 2 000 requests a
second, and it fails now and then. A load balancer lets you run several.

## Act 2

Growth. The database starts to feel it, and the board wants redundancy: any
single node failing must not take Shortly down.

## Act 3

Scale. Users from overseas, a stricter availability target, and a Super Bowl
ad with a hot link and a bot flood.

## Debrief: db-read-ceiling

One database replica serves about 20 000 reads a second, and the p99 target is
now 50 ms. Redirects are the textbook case for a cache: the same few codes are
read over and over and almost never change. With a 90% hit ratio, the database
sees a tenth of the reads. Read replicas help too, but each costs as much as
the primary.

## Interview translation

A redirect is a key lookup read about a hundred times more often than it is
written, so the design is read-optimised: stateless app servers behind a load
balancer, cache-aside in front of the database (codes never change, so the
TTL can be long), and a CDN for the redirect responses themselves, which also
hides the distance to far users. Writes are small and rare: one primary with
a replica for failover handles them until the alias and import traffic grow,
then shard by code. Everything runs at least twice, in different zones, so
losing a zone costs capacity, not availability.
