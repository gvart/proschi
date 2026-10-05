---
type: estimate
difficulty: easy
tags: [estimation, networking]
related: [file-storage, pastebin]
answer: 25000
unit: dollars per month
tolerance: 1.5
---

## Question

A file service sends 500 TB a month to users. If data transfer out costs
$0.05 per GB, what is the monthly egress bill?

## Solution

500 TB = 500,000 GB. × $0.05 = **$25,000 a month**. Storing those bytes is
often much cheaper than sending them, which is why a CDN's lower bandwidth
price and caching matter for file and video services. (Prices vary by
provider and volume.)

Numbers: [Numbers to know](../docs/numbers/#cloud-costs).
