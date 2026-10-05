---
type: flip
difficulty: easy
tags: [storage]
related: [video-streaming]
---

## Front

A job needs a 200 MB video. Why not put the file in the queue message?

## Back

Brokers are built for small messages (SQS and Kafka default to about 1 MB;
some allow more), and large ones slow everything down. Store the file in **object
storage** and send only its key (the **claim check**); the consumer fetches
the bytes itself.
