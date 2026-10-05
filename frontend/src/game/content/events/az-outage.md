---
title: Availability zone outage
icon: cloud-off
category: incident
topic: availability
learn: [surviving-a-zone, correlated-failures]
effect: az-down
duration: 2
telegraph: Your cloud region reports power problems in one availability zone.
min-wave: 4
---

## What happened

One of three availability zones went dark. Every component lost a third of its replicas (rounded up): a single instance went down with it.

## Why

Instances in one zone share power, network and cooling, so they fail together. Replicas only protect you if they are spread across zones and the survivors can carry the load.

## What a senior engineer would do

Run at least two replicas of everything on the request path, in different zones, and size them so the remaining zones can take the peak (N+1). Test it by turning a zone off.
