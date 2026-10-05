---
type: estimate
difficulty: easy
tags: [networking, storage]
answer: 80
unit: Gbit/s
---

## Question

A photo app serves 50,000 image views a second at peak, and an image averages
200 KB. What outbound bandwidth does that need?

## Solution

50,000 × 200 KB = 10,000,000 KB = 10 GB/s. Network links are measured in
bits: 10 GB/s × 8 = **80 Gbit/s**. That is far beyond a few servers' network
cards, which is why images are served from a CDN.
