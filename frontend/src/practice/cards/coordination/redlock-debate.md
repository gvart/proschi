---
type: flip
difficulty: hard
tags: [consistency]
distinct-from: [fencing-tokens]
---

## Front

Redlock takes a lock on a majority of several independent Redis servers.
Why is it debated whether it is safe?

## Back

Its safety depends on timing: bounded network delays, process pauses and
clock drift. Critics (notably Martin Kleppmann) showed how a long GC pause
or a clock jump lets two clients both believe they hold the lock, and it
gives out no fencing token for the resource to check. Its author argued
these assumptions are reasonable in practice.

## Why

A common reading: a Redis lock is fine when it only avoids duplicate work
and a rare double run is harmless. When two holders would corrupt data, use
a consensus-based lock (ZooKeeper, etcd) and have the resource check fencing
tokens.
