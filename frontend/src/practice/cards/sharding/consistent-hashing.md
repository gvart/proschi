---
type: flip
difficulty: medium
decks: [sample]
tags: [caching]
related: [cdn-tiered-cache]
---

## Front

Why use consistent hashing instead of `hash(key) % N` to pick a shard?

## Back

With `% N`, adding or removing one server changes N and remaps almost every
key. With consistent hashing, only about **1/N of the keys move**, those
between the new server and its neighbour on the ring. Virtual nodes spread the
load evenly.
