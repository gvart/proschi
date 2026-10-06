---
type: choice
difficulty: easy
tags: [storage]
---

## Question

A thumbnail worker reads uploaded images and writes thumbnails to the same
bucket. Which permissions follow least privilege?

## Options

- [ ] Full access to the bucket, to keep the policy simple
- [ ] The same role as the API servers
- [x] Read on the `uploads/` prefix and write on the `thumbnails/` prefix only
- [ ] Read and write on every bucket in the account

## Why

If the worker is compromised, say through a malicious image that exploits
the image library, the attacker gets only what its role allows. One role per
workload, scoped to the actions and resources it uses, keeps the blast radius
small.
