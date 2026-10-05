---
type: flip
difficulty: medium
tags: [availability]
related: [cdn-tiered-cache]
---

## Front

How does **anycast** send each user to a nearby server, and where is it used?

## Back

Many locations announce the **same IP address** over BGP, and the internet's
routers deliver each packet to the closest one in routing terms. CDNs, public
DNS resolvers and DDoS protection use it: users reach a nearby site, and a
failed site simply stops announcing the address.

## Why

The catch: a routing change can move a client to another site mid-connection,
so anycast suits short requests and UDP better than long-lived TCP sessions.
