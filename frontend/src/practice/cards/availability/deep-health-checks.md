---
type: flip
difficulty: hard
tags: [resilience]
---

## Front

Should a load balancer's health check also check the database? What can go
wrong?

## Back

If every server's check fails when the shared database has a hiccup, the load
balancer marks **all servers unhealthy at once** and takes the whole service
down, even for requests that did not need the database. Keep the routing
check about the server itself, and handle dependency failures with
degradation instead.
