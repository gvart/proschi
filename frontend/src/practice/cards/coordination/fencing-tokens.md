---
type: flip
difficulty: hard
tags: [consistency]
related: [job-queue]
distinct-from: [split-brain, leader-lease]
---

## Front

A lock holder freezes in a long GC pause, its lease expires, another client
takes the lock, then the first one wakes up and writes. How do **fencing
tokens** stop the damage?

## Back

The lock service hands out a number that grows with every grant (33, then
34). Each write to the protected resource carries it, and the **resource
rejects any token lower than the highest it has seen**. The paused client's
write with 33 arrives after 34's and is refused.

## Why

The check must be done by the resource (the database or storage), not by the
client, because the client cannot know it was paused. ZooKeeper's zxid or
an etcd revision can serve as the token.
