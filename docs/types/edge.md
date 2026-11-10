# Built-in types: edge

DNS, CDNs, load balancers, API gateways and firewalls: what a request passes before it reaches a service. Generated from [edge.proschi](../../frontend/src/dsl/stdlib/edge.proschi); [component types](../TYPES.md) explains how to read and extend them.

## Edge

What a request passes through before it reaches a service: DNS, a CDN, a load balancer or a gateway.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](core.md#component)
- **Extended by:** [HTTP Edge](#http-edge), [DNS](#dns), [AWS Global Accelerator](cloud.md#aws-global-accelerator)
- **Kind:** `edge`

## HTTP Edge

An edge component that takes HTTP requests and passes them on.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [CDN](#cdn), [Load Balancer](#load-balancer), [API Gateway](#api-gateway), [WAF](#waf)
- **Kind:** `edge`
- **Protocol:** `HTTP`
- **Read:** `GET`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`
- **Write:** `POST`, `PUT`, `PATCH`, `DELETE`
- **Statuses:** `100`, `101`, `102`, `103`, `200`, `201`, `202`, `203`, `204`, `205`, `206`, `207`, `208`, `226`, `300`, `301`, `302`, `303`, `304`, `307`, `308`, `400`, `401`, `402`, `403`, `404`, `405`, `406`, `407`, `408`, `409`, `410`, `411`, `412`, `413`, `414`, `415`, `416`, `417`, `418`, `421`, `422`, `423`, `424`, `425`, `426`, `428`, `429`, `431`, `451`, `500`, `501`, `502`, `503`, `504`, `505`, `506`, `507`, `508`, `510`, `511`
- **Headers:** `Accept`, `Accept-Encoding`, `Accept-Language`, `Accept-Ranges`, `Age`, `Allow`, `Authorization`, `Cache-Control`, `Connection`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Content-Length`, `Content-Range`, `Content-Type`, `Cookie`, `Date`, `ETag`, `Expires`, `Host`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `If-Range`, `If-Unmodified-Since`, `Last-Modified`, `Link`, `Location`, `Origin`, `Range`, `Referer`, `Retry-After`, `Server`, `Set-Cookie`, `User-Agent`, `Vary`, `Upgrade`, `WWW-Authenticate`, `Proxy-Authorization`, `Strict-Transport-Security`, `Content-Security-Policy`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Allow-Credentials`, `Access-Control-Max-Age`, `Access-Control-Request-Method`, `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, `X-Request-Id`, `X-Correlation-Id`, `Traceparent`, `Tracestate`, `Idempotency-Key`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `X-API-Key`, `X-Content-Type-Options`, `X-Frame-Options`, `Sec-WebSocket-Key`, `Sec-WebSocket-Accept`, `Sec-WebSocket-Protocol`

## DNS

A DNS service: turns a host name into the addresses to connect to.

- **Extends:** [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [AWS Route53](cloud.md#aws-route53), [GCP Cloud DNS](cloud.md#gcp-cloud-dns), [Azure DNS](cloud.md#azure-dns)
- **Kind:** `dns`
- **Protocol:** `DNS`
- **Read:** `QUERY`, `RESOLVE`
- **Write:** `UPDATE`

## CDN

A content delivery network: caches responses at edge locations near the users.

- **Extends:** [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [Fastly](#fastly), [Akamai](#akamai), [AWS CloudFront](cloud.md#aws-cloudfront), [GCP Cloud CDN](cloud.md#gcp-cloud-cdn), [Azure CDN](cloud.md#azure-cdn), [Azure Front Door](cloud.md#azure-front-door), [Cloudflare](cloud.md#cloudflare)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** `PURGE`, plus 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Load Balancer

Spreads requests over the replicas behind it and stops sending to unhealthy ones.

- **Extends:** [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [nginx](#nginx), [Envoy](#envoy), [HAProxy](#haproxy), [Traefik](#traefik), [Kubernetes Ingress](#kubernetes-ingress), [AWS Load Balancer](cloud.md#aws-load-balancer), [GCP Load Balancing](cloud.md#gcp-load-balancing), [Azure Load Balancer](cloud.md#azure-load-balancer), [Azure Application Gateway](cloud.md#azure-application-gateway)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## API Gateway

One entry point for an API: routing, authentication and rate limits before the services.

- **Extends:** [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [Kong](#kong), [Spring Cloud Gateway](#spring-cloud-gateway), [AWS API Gateway](cloud.md#aws-api-gateway), [GCP Apigee](cloud.md#gcp-apigee), [Azure API Management](cloud.md#azure-api-management)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## WAF

A web application firewall: blocks malicious requests at the edge.

- **Extends:** [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Extended by:** [AWS WAF](cloud.md#aws-waf)
- **Kind:** `edge`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Fastly

Fastly, the programmable CDN.

- **Extends:** [CDN](#cdn) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 1 from [CDN](#cdn), 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Akamai

Akamai, the CDN and edge security platform.

- **Extends:** [CDN](#cdn) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `cdn`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 1 from [CDN](#cdn), 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## nginx

nginx, the web server used as a reverse proxy and load balancer.

- **Extends:** [Load Balancer](#load-balancer) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Envoy

Envoy, the L7 proxy behind most service meshes.

- **Extends:** [Load Balancer](#load-balancer) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## HAProxy

HAProxy, the TCP and HTTP load balancer.

- **Extends:** [Load Balancer](#load-balancer) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Traefik

Traefik, the reverse proxy that configures itself from containers.

- **Extends:** [Load Balancer](#load-balancer) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Kubernetes Ingress

A Kubernetes ingress controller: routes outside HTTP traffic to the cluster's services.

- **Extends:** [Load Balancer](#load-balancer) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `loadbalancer`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Kong

Kong, the open source API gateway built on nginx.

- **Extends:** [API Gateway](#api-gateway) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)

## Spring Cloud Gateway

Spring Cloud Gateway, an API gateway for Spring services.

- **Extends:** [API Gateway](#api-gateway) › [HTTP Edge](#http-edge) › [Edge](#edge) › [Component](core.md#component)
- **Kind:** `gateway`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Edge](#http-edge)
- **Write:** 4 from [HTTP Edge](#http-edge)
- **Statuses:** 61 from [HTTP Edge](#http-edge)
- **Headers:** 69 from [HTTP Edge](#http-edge)
