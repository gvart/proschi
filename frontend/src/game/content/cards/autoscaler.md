---
name: Autoscaler
icon: chevrons-up
rarity: rare
topic: resilience
learn: [scale-on-message-age, servers-for-peak-load]
effect: autoscale
value: 0
unlock: 6
---

## Text

App servers and workers resize every tick to run at about 60%, between half and three times what you planned.

## Why

Autoscaling follows the load so you pay for the trough at trough prices and still have capacity at the peak. It reacts to load it has already seen, so it lags a sudden spike, and it needs headroom above it to scale into.
