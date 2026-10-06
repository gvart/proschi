---
name: Burstable instances
icon: battery-charging
rarity: common
topic: estimation
learn: [littles-law-concurrency]
effect: capacity
target: app
stat: rps
value: 1.35
downside: latency
downside-target: app
downside-value: 1.25
---

## Text

App servers take 35% more requests. But they answer 25% slower once their CPU credits run low.

## Why

Burstable instances run above their baseline on saved-up credits. They are cheap capacity for spiky traffic, and once the credits are spent the CPU is throttled, so every request waits longer.
