---
title: Viral post
category: spike
topic: estimation
learn: [servers-for-peak-load, load-shedding]
effect: traffic
value: 2
duration: 2
telegraph: A celebrity is about to share one of your links.
counters: [autoscaler]
min-wave: 2
---

## What happened

Traffic doubled on top of the usual curve for two ticks.

## Why

Capacity planned for the average day falls over on the best day. Peaks of several times the average are normal for consumer products, and they arrive with no warning.

## What a senior engineer would do

Plan for the peak, not the mean: keep headroom (run at 60 to 70% at the expected peak), autoscale with room above, and shed or queue what you cannot serve instead of letting every request time out.
