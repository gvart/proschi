---
title: Launch day
category: spike
topic: estimation
learn: [servers-for-peak-load, qps-from-daily-users]
effect: traffic
value: 1.5
duration: 4
from: 3
telegraph: The press embargo lifts mid-month.
counters: [autoscaler]
min-wave: 1
---

## What happened

Traffic ran 50% over the curve for four ticks.

## Why

Launches, sales and announcements put weeks of attention into hours.

## What a senior engineer would do

Load test before the date, pre-scale for the expected peak with headroom, and know what you will shed first if the estimate is wrong.
