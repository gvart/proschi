---
type: choice
difficulty: easy
tags: [availability]
---

## Question

A load balancer uses sticky sessions, pinning each user to one server that
keeps their session in memory. What is the main drawback?

## Options

- [ ] Every request needs an extra DNS lookup
- [x] Load can become uneven, and a server's crash logs out all of its users
- [ ] Servers can no longer use TLS
- [ ] It only works with layer 4 load balancers

## Why

The usual alternative is stateless servers with sessions in a shared store
(such as Redis) or in a signed token, so any server can take any request and
servers can be added or removed freely.
