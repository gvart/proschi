---
type: flip
difficulty: medium
tags: [resilience]
---

## Front

Many outages start with a change. How do you limit the damage of a bad
deploy?

## Back

Roll it out **gradually**: a canary on a small share of traffic, then wider
stages, with automatic **rollback** when error or latency metrics get worse.
Feature flags let you turn off new behaviour without a redeploy. Deploy one
zone or region at a time.
