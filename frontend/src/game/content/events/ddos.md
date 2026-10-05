---
title: Bot flood
category: incident
topic: api-design
learn: [token-bucket, rate-limit-response, load-shedding]
effect: bots
value: 2
duration: 2
telegraph: A botnet has started probing your API.
min-wave: 5
---

## What happened

Bots sent twice your real traffic, requesting random keys. Without a firewall or gateway they reached the app servers and the database, missing every cache.

## Why

Bot traffic looks like real traffic to an app server, but it is never cached (random keys) and earns nothing. It is cheapest to stop at the edge, before it costs an instance or a database read.

## What a senior engineer would do

Put a WAF or a rate-limiting gateway in front, answer floods with 429, and never let unauthenticated traffic reach the database unfiltered.
