---
title: Multi-Region Active-Active
summary: "Netflix's two US regions both serve, replicate asynchronously, and either can carry everyone."
difficulty: hard
company: Netflix
tags: [availability, replication, real-world]
version: 2
strict: true
hints:
  - "Two regions that both serve is half the design. The other half is the day one of them is evacuated: how much traffic does the surviving region carry then?"
  - "Build US-West as a mirror of US-East (westZuul, westApi, westCache, westDb). In Browse, the East scenarios touch only east nodes and the West scenarios only west nodes; Browse in failover sends each evacuated region's members to the other one."
  - "Save progress writes the local Cassandra before it answers. Copying the bookmark to the other region's Cassandra, and deleting it from that region's EVCache, are ->> steps after the answer."
  - "Count one region's API load in the drill: its own browse and writes plus the browse it takes over, 9k requests a second at 2k per instance. Size it, and Zuul at 10k per instance, so that losing one more instance still keeps p99 under the limits."
---

Netflix runs the services on a member's call path in two AWS regions at
once, **US-East-1** (Virginia) and **US-West-2** (Oregon). Geo-DNS sends
members in each part of North America to one of them, about half to each.
Every service is stateless; everything a member's request reads or writes
lives in Cassandra, which replicates between the regions asynchronously, and
no request crosses from one region to the other.

Regions do not fail often, but a bad change can break a critical service in
one. When that happens, Netflix overrides geo-DNS and sends every member to
the healthy region, which must then carry all of North America's traffic on
its own. Design both regions so that either can.

## Functional requirements

- **Browse**: a member opens the home screen. DNS resolves the API's name
  to the member's region, then Zuul, the region's edge gateway, passes the
  request to the playback API, which reads the member's rows from EVCache
  and, on a miss, from Cassandra (then fills EVCache). Scenarios: **East**
  and **West** (the region DNS picked), each with **Hit** and **Miss**,
  named `"East › Hit"`, `"East › Miss"`, `"West › Hit"` and `"West › Miss"`.
- **Save progress**: the player saves where the member stopped watching.
  The write is acknowledged once the member's region has it in Cassandra; it
  also deletes the bookmark from that region's EVCache. Afterwards Cassandra
  replicates it to the other region, and the API sends the other region a
  delete for its cached copy. Scenarios: **East** and **West**.
- **Browse in failover**: one region is evacuated and DNS sends its members
  to the other. Scenarios: **East evacuated** (US-East's members, served by
  US-West) and **West evacuated**, each with **Hit** and **Miss**.

Use these use case and scenario names exactly: the traffic, requirements
and tests in `problem.proschi` refer to them.

## Scale

- **8k Browse** and **2k Save progress** requests a second at peak, split
  50/50 between the regions by geo-DNS. Netflix publishes the rough 50/50
  split, not the rates: they are assumptions for the exercise.
- **Browse in failover**: 8k requests a second, half of them **East
  evacuated** and half **West evacuated**. The simulator analyses one load
  at a time, so this use case adds to each region the members it takes over
  in a failover. Together with Browse, each region carries what it would on
  the day the other is evacuated: its own members and the other region's.
- EVCache answers **90%** of Browse reads. Members just moved to the other
  region are not in its EVCache yet: assume **70%** hits for Browse in
  failover while it warms. Both hit rates are assumptions.
- One Zuul instance takes about **10k requests a second**, one playback API
  instance **2k**, one EVCache node **100k** and one Cassandra node **20k**
  (the simulator's defaults for an API gateway, a service, Memcached and
  Cassandra).

## Constraints

- Each region has its own Zuul, playback API, EVCache and Cassandra, with
  these ids and types: `eastZuul` and `westZuul` `[API Gateway]`, `eastApi`
  and `westApi` `[Service]`, `eastCache` and `westCache` `[Memcached]`,
  `eastDb` and `westDb` `[Cassandra]`.
- Every request starts at the member's device and asks DNS for its region
  before reaching a gateway. No connection from the device to a service, a
  cache or a database.
- No request calls the other region while a member waits: reads and writes
  are local, replication is asynchronous.
- A member of an evacuated region touches nothing in that region.
- p99 of **Browse** and **Browse in failover** under **100 ms**; of **Save
  progress** under **130 ms**.
- Every use case available **99.99%** of the time, Netflix's internal goal.
- Save progress is durable before it is acknowledged.
- Losing any single instance must not break a latency limit, even with the
  failover load on.
- At most **$5,000 / month** for both regions.

## What is given

`problem.proschi` declares `viewer`, the member's device, and `dns`, the
geo-DNS layer (UltraDNS's directional records over Route53, switched with
Netflix's Denominator). Add both regions' nodes, connect them, and write the
three use cases.

## What this model leaves out

- Regions and distance are not simulated: the model has no network latency,
  so a cross-region call costs no more than a local one. The tests forbid
  such calls on the request path instead.
- A failover is not an event in the simulation. The failover load is added
  as its own use case, and each region's nodes are sized for it; the
  steady state and the failover are measured together, not one after the
  other. Save progress is not moved in the failover use case: a region's
  Cassandra already applies every write through replication, and the extra
  1k writes a second on the surviving region's API are within its headroom.
- Losing a whole region is not a node failure the simulator can inject:
  `survive any node failure` loses one instance at a time. The flow test on
  Browse in failover checks that evacuated members never touch their region.
- Replication lag and conflicts are not simulated: a write is in both
  regions at once. Netflix measured reads in the other region 500 ms after
  a write; two concurrent writes to one row in two regions are reconciled by
  Cassandra's last-write-wins timestamps.
- Autoscaling, cache warming over time and Zuul's load shedding during a
  shift are not simulated; the replica counts are the capacity each region
  must reach.

## Based on

- Ruslan Meshenberg, Naresh Gopalani and Luke Kosewski,
  [Active-Active for Multi-Regional Resiliency](https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b),
  Netflix Technology Blog, December 2013: an internal availability goal of
  99.99%; every service on the member's call path deployed in US-East-1 and
  US-West-2; services stateless, every resource used in-region, no
  cross-regional calls on the call path and asynchronous data replication;
  members geo-DNS routed to the closest region with a rough 50/50 split,
  overridden to send everyone to a healthy region in a region-wide outage;
  UltraDNS directional records with a Route53 layer in front of the ELBs,
  controlled by Denominator; Zuul in front of every edge service, extended
  to handle mis-routed requests, to put a region in failover mode and to
  shed load above a set level while services scale up and caches are cold;
  all member data in Cassandra with asynchronous multi-region replication,
  a test that read 1 million records in the other region 500 ms after they
  were written; EVCache (Memcached) in front of Cassandra, kept consistent by
  sending the other region an invalidation through SQS on every write; and
  the Chaos Gorilla, Split-brain and Chaos Kong exercises, the last moving
  most US traffic to US-West-2 for over 24 hours, gradually, so services
  could scale up and caches warm.
