---
title: Drop
summary: Flash-sale ticketing. Millions of fans, a few thousand seats, and no seat sold twice.
difficulty: hard
tags: [consistency, sharding, rate-limiting, write-heavy]
related: [flash-sale, ticket-booking]
cards: [replicas-do-not-scale-writes, shards-for-write-rate, pessimistic-locking-when, conditional-stock-update, token-bucket]
order: 4
version: 1
---

## Briefing

Drop sells concert tickets. Most days are quiet; then a sale opens and
everyone arrives in the same minute, along with their bots. Holding a seat
is a read and a write that must see every other hold, so the seat data
stays on a strongly consistent store. Sell fast, sell each seat once, and
keep the bots out.

## Act 1

Soft launch. Payments are a slow third party you have to wait for; receipts
are not.

## Act 2

Growth. Holds become the hot path, and every hold is a write to one primary.

## Act 3

Scale. Fans abroad, a strict checkout target, and the reunion tour.

## Debrief: async-receipt

The buyer needs to know the payment went through, so the payment call stays
on the request. The receipt email does not: put it on a queue and let a
worker send it, and checkout no longer waits for the email provider.

## Debrief: write-ceiling

Read replicas add reads, but every hold is a write, and a single primary
takes about 5 000 writes a second. Shard the seats (by event and section) so
each shard has its own primary. A NoSQL store would take the writes, but it
is eventually consistent: two fans could hold the same seat.

## Interview translation

Separate browsing from buying: event pages are cached and served from a CDN,
while holds and orders go to a strongly consistent, sharded relational store
with conditional updates (`UPDATE … WHERE status = 'free'`), so a seat is
sold once. The payment call is on the request path behind a timeout and a
circuit breaker; receipts are sent asynchronously. A WAF and a rate-limiting
gateway keep bots from taking the inventory or the database down.
