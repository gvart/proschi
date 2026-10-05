---
type: flip
difficulty: hard
tags: [databases]
---

## Front

What is the main weakness of two-phase commit (2PC)?

## Back

It **blocks**: once participants vote "yes" in the prepare phase, they must
hold their locks until the coordinator says commit or abort. If the
coordinator crashes then, they cannot decide alone and stay stuck until it
recovers. Every transaction also pays extra round trips and is only as
available as all participants together.
