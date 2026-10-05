---
type: choice
difficulty: hard
tags: [queues]
---

## Question

Under load, requests wait 30 s in a server's queue, but clients give up after
5 s. What is the main problem?

## Options

- [x] The server spends its capacity on requests whose clients have already gone
- [ ] The queue uses too much memory
- [ ] Clients get duplicate responses
- [ ] Requests are processed out of order

## Why

The server does useless work while new requests wait behind it, so it never
recovers. Bound the queue, drop requests that have already waited longer than
the client's timeout, or serve the newest first under overload.
