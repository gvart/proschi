---
type: flip
difficulty: hard
tags: [streaming, consistency]
related: [nearby-search]
---

## Front

A user flies to another city, so their new location belongs to another
geoshard. What does the indexer do, and how do you stop two quick moves from
being applied in the wrong order?

## Back

Delete the user from the old geoshard and insert them into the new one. Key
the change events by user id, so all of one user's changes land in one
stream partition and are applied in order by one consumer.

## Why

The two writes are on different indexes and are not atomic. Out of order, an
older move can put the user back where they were, or in two geoshards at
once. A periodic resync from the source of truth repairs what slips through.
