---
title: Replicated Git Storage
summary: "GitHub's Spokes: three replicas per repository, quorum pushes, reads from any in-sync copy."
difficulty: medium
company: GitHub
tags: [replication, consistency, availability, read-heavy, real-world]
hints:
  - "Git is distributed: a repository can be copied to several servers and kept in sync with Git itself. If every copy is a full repository, which of them can answer a fetch?"
  - "Put a proxy in front of the file servers (id fs, x3: one replica per copy). A push goes to all three copies with an x3 fan-out; a fetch reads just one, so three copies give nearly three times the read capacity of one server and a standby."
  - "Commit a push in phases (a prepare that collects votes, then the commit) and answer once a quorum of two has committed. In \"One replica down\", the call to the dead server fails (-x), the other two commit (x2), and the push still answers 200. Then record the new checksums in routes before answering."
  - "Before a fetch, read routes to learn which replicas are up to date, then read one of them. Size fs with shards: about 26k requests a second reach it (a push counts three times), and a set of three that loses a server must still keep pushes under 100 ms. The proxy needs about 16 replicas."
---

GitHub used to store each repository on a file server with a hot standby
next to it, mirrored disk block by block with DRBD. The standby served
nothing, a failover took the repository offline until it finished, and
losing both servers of a pair took hundreds of thousands of repositories
down.

DGit, later renamed Spokes, replicates at the Git level instead. Every
repository lives on three file servers as three ordinary Git repositories.
A proxy in front of them sends each push to all three, runs a three-phase
commit and acknowledges it once at least two replicas have applied the same
update. Each replica's checksum says whether it is up to date, so a fetch
can go to any replica that is, usually the closest.

## Functional requirements

- **Push**: a developer pushes commits and gets `200` once the update is
  committed on at least two of the repository's three replicas. Two
  scenarios:
  - `"All replicas commit"`: all three file servers are up.
  - `"One replica down"`: one of the three does not answer; the other two
    form a quorum and the push still succeeds.

  After the commit, the replicas' new checksums are recorded in `routes`
  before the developer hears back.
- **Fetch**: a developer fetches or clones a repository and gets `200` with
  a packfile. The proxy looks up which replicas are up to date and reads one
  of them.

Name the file servers `fs`: the tests in `problem.proschi` refer to them,
to `routes`, and to the use case and scenario names above.

## Scale

- Spokes holds over **38 million repositories** and **36 million gists**.
- In this exercise, one slice of the fleet takes **1k pushes** and **20k
  fetches** per second at peak: most Git traffic is reads. One push in a
  thousand finds a replica down.

## Constraints

- Every repository on **three** file servers (`fs` with three replicas; add
  shards for more sets of three).
- Nothing but the proxy talks to the file servers or to `routes`.
- A push is durable on a quorum before the developer hears back, and still
  succeeds when one of its three servers is down.
- p99 of **Push** under **100 ms**, of **Fetch** under **75 ms**; both
  available **99.99%** of the time.
- Losing any single machine, a file server included, must not break a
  latency limit.
- At most **$6,800 / month**, `routes` included.

## What is given

`problem.proschi` declares the `dev` client and `routes`, a MySQL table of
which file servers hold each repository and each replica's checksum (four
replicas). Add the proxy, the file servers, the connections and the two use
cases.

The simulation does not count copies: one write step with an `x3` fan-out
stands for the three replicas each taking the update, and a node's replicas
share its load evenly. Replication lag, repair of a replica that fell behind
and the choice of the *closest* replica are not modelled.

## Based on

- Patrick Reynolds, [Introducing DGit](https://github.blog/engineering/architecture-optimization/introducing-dgit/),
  GitHub blog, April 2016: three copies of every repository on three
  servers, replication at the Git level instead of RAID and DRBD, reads
  load-balanced over the replicas without synchronisation, and new copies
  made automatically when a server fails.
- [Building resilience in Spokes](https://github.blog/engineering/infrastructure/building-resilience-in-spokes/),
  GitHub blog: over 38 million repositories and 36 million gists, at least
  three copies of each, a three-phase commit that refuses writes it cannot
  commit to at least two replicas, and checksums that tell which replicas
  are in sync.
- Michael Haggerty, [Stretching Spokes](https://github.blog/engineering/infrastructure/stretching-spokes/),
  GitHub blog, October 2017: Spokes across data centers, the quorum vote,
  and reads routed to the closest replica that is in sync.
