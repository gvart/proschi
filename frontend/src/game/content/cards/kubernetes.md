---
name: Kubernetes
icon: ship-wheel
rarity: rare
topic: resilience
learn: [servers-for-peak-load, scale-on-message-age]
effect: autoscale
value: 0
downside: cost
downside-target: app
downside-value: 1.25
unlock: 8
---

## Text

App servers and workers resize every tick to run at about 60%. But the control plane and the spare nodes cost 25% more on every app server.

## Why

A cluster scheduler packs and scales your services for you, and it is not free: the control plane, the system pods on every node and the headroom it keeps for scheduling all show up on the bill. It pays off when the load swings more than the overhead costs.
