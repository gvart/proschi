---
title: News Feed
summary: Fan out on write through a queue into feed caches.
difficulty: medium
tags: [fan-out, queues, caching, read-heavy]
hints:
  - Feeds are read 20 times more often than posts are written. Could each feed be ready before anyone asks for it?
  - Precompute feeds into a cache when a post is published (fan-out on write); then a read is a lookup of post ids plus the posts themselves, also from a cache.
  - "Listing followers takes 50 ms and each post goes to ~200 feeds: do not make the author wait. Store the post, put an event on a queue, answer 201, and let a worker list the followers and write the feeds."
  - "Write the feed step as x200 ZADD …: 500 posts a second become 100k feed writes a second. Size the feed cache so it survives losing a node under that load, and the Feed API for 10.5k rps at well under 70% busy."
---

Design the home timeline of a social network: people publish short
posts, and everyone who follows them sees those posts at the top of their
feed, newest first.

## Functional requirements

- **Publish post**: a user posts up to 500 characters and gets `201` with
  the post id. The post must show up in the feeds of all their followers
  within a few seconds.
- **Read feed**: a user opens the app and gets the 50 newest posts of the
  people they follow (`200`).

Use these use case names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- 20M daily active users. **Read feed: 10k rps** at peak.
- **Publish post: 500 rps** at peak.
- A user has 200 followers on average, and nobody has more than 5,000
  (accounts with millions of followers are a follow-up, not part of this
  problem). So each post lands in about 200 feeds: write the step that adds
  a post to one follower's feed with the fan-out prefix, `x200`, so the
  simulation counts all ~100k feed writes a second.
- A feed only needs its newest 500 post ids.

## Constraints

- p99 of reading the feed under **100 ms**, of publishing under **150 ms**.
- Reading the feed available **99.9%** of the time.
- A post is never lost once the user got `201`, and no feed ever shows a
  post that was not stored.
- Publishing never waits for the social graph or for the feeds: the author
  gets `201` as soon as the post is stored.
- Reading a feed never touches a database or the social graph.
- Losing any single machine must not take the service down.
- At most **$4,000 / month**, the social graph included.

## What is given

`problem.proschi` declares the `user` and the existing `graph` service
that knows who follows whom. Listing the followers of an account pages
through up to 5,000 ids and takes about **50 ms**. The file also holds the
traffic, requirements and tests. Add the components, the connections and the
two use cases.
