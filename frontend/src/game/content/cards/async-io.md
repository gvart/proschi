---
name: Async I/O
icon: workflow
rarity: common
topic: api-design
learn: [littles-law-concurrency]
effect: capacity
target: app
stat: rps
value: 1.25
---

## Text

App servers take 25% more requests.

## Why

A server that blocks a thread on every database call is limited by threads, not CPU. Non-blocking I/O (event loops, virtual threads) keeps the CPU busy while requests wait, so each instance serves more at once.
