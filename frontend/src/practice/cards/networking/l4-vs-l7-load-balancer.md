---
type: choice
difficulty: easy
decks: [sample]
tags: [api-design]
---

## Question

You need to send `/api/*` requests to one pool of servers and `/static/*` to
another. Which load balancer can do this?

## Options

- [ ] A layer 4 (TCP) load balancer
- [x] A layer 7 (HTTP) load balancer
- [ ] DNS round robin
- [ ] Either layer 4 or layer 7; both see the path

## Why

Routing by URL path needs the HTTP request, which only a layer 7 load balancer
reads. Layer 4 sees IP addresses and ports, and DNS only picks an address.
