---
type: choice
difficulty: hard
decks: [sample]
tags: [queues]
related: [chat, discord-messages]
---

## Question

A chat has 50 WebSocket servers. A message for Bob arrives at server 1, but
Bob is connected to server 7. How does it reach him?

## Options

- [ ] Server 1 opens its own connection to Bob's phone
- [x] Look up Bob's server in a connection registry (or a pub/sub channel per user) and forward it there
- [ ] Broadcast it to all 50 servers and let each check
- [ ] Bob's client polls server 1

## Why

Each server records which users it holds (e.g. in Redis), or subscribes to a
channel per connected user. Broadcasting works for a handful of servers but
multiplies traffic by the server count.
