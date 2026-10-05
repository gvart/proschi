---
type: choice
difficulty: easy
tags: [queues]
related: [file-storage, video-streaming]
---

## Question

Clients upload straight to object storage with pre-signed URLs. How should
the backend learn that an upload finished?

## Options

- [ ] Trust a "done" call from the client
- [x] The bucket's event notification puts a message on a queue for a worker
- [ ] List the bucket every second
- [ ] Read the load balancer's logs

## Why

The client may crash, lie or lose its connection after uploading. The bucket
knows for certain, and a queue between it and the worker keeps the event
until it is processed.
