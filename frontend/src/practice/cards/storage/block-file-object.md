---
type: choice
difficulty: medium
tags: [databases]
---

## Question

Where should a database server keep its data files?

## Options

- [x] Block storage (a local SSD or a network volume like EBS)
- [ ] Object storage like S3
- [ ] A CDN
- [ ] The database's own logs only

## Why

A database rewrites small pieces of its files in place with low latency,
which block devices provide. Object storage stores whole objects over HTTP:
great for files and backups, too slow and coarse for live database pages.
