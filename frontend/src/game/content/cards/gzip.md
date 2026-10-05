---
name: Compression
icon: file-archive
rarity: common
topic: networking
learn: [egress-bill, bits-vs-bytes]
effect: payload
value: 0.4
---

## Text

Every payload is 60% smaller: less transfer time and a smaller egress bill.

## Why

Text formats like JSON and HTML compress 3 to 10 times with gzip or Brotli. The CPU cost is small next to the bandwidth saved, and you pay for egress by the byte.
