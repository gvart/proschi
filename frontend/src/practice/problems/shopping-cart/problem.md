---
title: Always-writable Shopping Cart
summary: "Amazon's Dynamo cart: never reject an add; merge versions on read."
difficulty: easy
tags: [availability, consistency, replication, real-world]
company: Amazon
hints:
  - "Which is worse for a shop: a cart that is briefly out of date, or an \"Add to cart\" that fails? The store you pick decides which one you get."
  - "A relational database has one primary per shard: while it fails over, writes wait. A leaderless store (DynamoDB, Cassandra) takes a write on any replica. With three replicas of everything, availability is far above 99.999%."
  - "The price of always accepting writes is that two writes can race and leave two versions. In \"Divergent versions\", read both, merge them (the union of the items) and write the merged cart back before answering."
  - "Every component needs a second replica to survive losing one machine; three replicas of the store are what keep writes available."
---

Amazon's shopping cart must take every "Add to cart", even while servers,
disks or network links fail: an add that is rejected or forgotten is a lost
sale. This is the service Amazon built Dynamo for. Dynamo gives up
consistency under failure to stay writable: any replica takes a write, and
when concurrent writes leave several versions of a cart, the application
merges them on the next read.

## Functional requirements

- **Add to cart**: a shopper adds an item to their cart and gets `200`.
  The add is written to durable storage before the answer.
- **View cart**: a shopper opens their cart and gets `200`. Model it with two
  scenarios:
  - `"One version"`: the store holds a single version of the cart.
  - `"Divergent versions"`: two writes raced (or a node was partitioned),
    and the store returns several versions. The service merges them so that
    no add is lost, and writes the merged cart back before answering.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **500 adds** and **1k cart views** per second at peak.
- In Amazon's measurement over 24 hours, **99.94%** of reads saw exactly one
  version; the rest saw two or more.

## Constraints

- The **99.9th** percentile of both use cases under **300 ms**: the SLA
  Dynamo's paper gives as its example.
- **Add to cart** available **99.999%** of the time: adds are never
  rejected because a primary is failing over.
- An add is durable once the shopper hears `200`.
- Carts live in an eventually consistent store: a strongly consistent one
  has to refuse writes it cannot coordinate.
- Losing any single machine must not take the cart down.
- At most **$3,000 / month**.

## What is given

`problem.proschi` declares the `shopper` and holds the traffic,
requirements and tests. Add the components, the connections and the two use
cases.

## Based on

- G. DeCandia et al., [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf),
  SOSP 2007: the shopping cart's "Add to cart" that "can never be forgotten
  or rejected", conflict resolution on read, the 300 ms SLA at the 99.9th
  percentile, and the measurement that 99.94% of cart requests saw one
  version.
- Werner Vogels, [Amazon's Dynamo](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html),
  All Things Distributed, October 2007.
