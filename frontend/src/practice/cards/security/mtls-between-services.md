---
type: flip
difficulty: medium
tags: [networking]
distinct-from: [tls-termination]
---

## Front

What does **mutual TLS** between internal services add over ordinary TLS,
and what does it cost?

## Back

With ordinary TLS only the client checks the server's certificate. With mTLS
the **caller presents a certificate too**, so every connection proves which
service is calling. Access rules can then say "only `orders` may call
`payments`" instead of trusting anything inside the network. The cost is
issuing and rotating a certificate for every workload.

## Why

A service mesh (Istio, Linkerd) or SPIFFE usually automates this with
short-lived certificates renewed every few hours, so a stolen certificate is
soon useless and nobody rotates certificates by hand.
