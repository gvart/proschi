---
type: flip
difficulty: medium
tags: [queues]
related: [search-indexing]
---

## Front

An indexer receives thousands of changed documents a second for a search
cluster that also answers queries. Why buffer them and send bulk requests
instead of one index request per document?

## Back

Each request has a fixed cost on the cluster: a network round trip, a
thread, a write to the transaction log and a refresh to schedule. One bulk
request of a few hundred documents pays that cost once, so indexing takes a
small share of the nodes and leaves the rest for queries. The price is a
little delay: a document waits until its batch is full or a short timer
fires.

## Why

Flush on whichever comes first, a size or a time limit, so a quiet stream
still reaches the index within a second or two. A bulk request reports a
result per document, so retry only the ones that failed.
