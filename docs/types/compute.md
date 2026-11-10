---
updated: 2026-11-10
---

# Built-in types: compute

Services, workers, functions and the platforms they run on. They list statuses and headers but no operations, so their requests are named freely. Generated from [compute.proschi](../../frontend/src/dsl/stdlib/compute.proschi); [component types](../TYPES.md) explains how to read and extend them.

## Compute

Code you run: a service, a worker, a function or the platform it runs on; its own requests are named freely.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](core.md#component)
- **Extended by:** [Service](#service), [Worker](#worker), [Platform](#platform), [Function](#function)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** `100`, `101`, `102`, `103`, `200`, `201`, `202`, `203`, `204`, `205`, `206`, `207`, `208`, `226`, `300`, `301`, `302`, `303`, `304`, `307`, `308`, `400`, `401`, `402`, `403`, `404`, `405`, `406`, `407`, `408`, `409`, `410`, `411`, `412`, `413`, `414`, `415`, `416`, `417`, `418`, `421`, `422`, `423`, `424`, `425`, `426`, `428`, `429`, `431`, `451`, `500`, `501`, `502`, `503`, `504`, `505`, `506`, `507`, `508`, `510`, `511`
- **Headers:** `Accept`, `Accept-Encoding`, `Accept-Language`, `Accept-Ranges`, `Age`, `Allow`, `Authorization`, `Cache-Control`, `Connection`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Content-Length`, `Content-Range`, `Content-Type`, `Cookie`, `Date`, `ETag`, `Expires`, `Host`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `If-Range`, `If-Unmodified-Since`, `Last-Modified`, `Link`, `Location`, `Origin`, `Range`, `Referer`, `Retry-After`, `Server`, `Set-Cookie`, `User-Agent`, `Vary`, `Upgrade`, `WWW-Authenticate`, `Proxy-Authorization`, `Strict-Transport-Security`, `Content-Security-Policy`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Allow-Credentials`, `Access-Control-Max-Age`, `Access-Control-Request-Method`, `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, `X-Request-Id`, `X-Correlation-Id`, `Traceparent`, `Tracestate`, `Idempotency-Key`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `X-API-Key`, `X-Content-Type-Options`, `X-Frame-Options`, `Sec-WebSocket-Key`, `Sec-WebSocket-Accept`, `Sec-WebSocket-Protocol`

## Service

A program you run that answers requests, whatever it is written in.

- **Extends:** [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [HTTP Service](#http-service), [gRPC](#grpc), [WebSocket](#websocket), [SOAP API](#soap-api), [Java](#java), [Kotlin](#kotlin), [Go](#go), [Node.js](#nodejs), [Python](#python), [Ruby on Rails](#ruby-on-rails), [.NET](#net), [PHP](#php), [Rust](#rust), [Elixir](#elixir)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Worker

A background program that takes jobs or events from a queue and processes them.

- **Extends:** [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## HTTP Service

A service whose requests are HTTP methods: GET, HEAD and OPTIONS read, POST, PUT, PATCH and DELETE write.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [REST API](#rest-api), [GraphQL](#graphql)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Icon:** `Service`
- **Read:** `GET`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`
- **Write:** `POST`, `PUT`, `PATCH`, `DELETE`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## REST API

A service with a REST interface: resources over HTTP methods and status codes.

- **Extends:** [HTTP Service](#http-service) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Read:** 5 from [HTTP Service](#http-service)
- **Write:** 4 from [HTTP Service](#http-service)
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## GraphQL

A service with a GraphQL interface: queries read, mutations write.

- **Extends:** [HTTP Service](#http-service) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `GraphQL`
- **Read:** `query`, `subscription`, plus 5 from [HTTP Service](#http-service)
- **Write:** `mutation`, plus 4 from [HTTP Service](#http-service)
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## gRPC

A service with a gRPC interface: typed calls over HTTP/2, named by its own .proto file.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `gRPC`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## WebSocket

A service that keeps a WebSocket open to each client and pushes messages both ways, named freely.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `WebSocket`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## SOAP API

A service with a SOAP interface: XML messages over HTTP.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `SOAP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Java

A service on the JVM, written in Java.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [Spring Boot](#spring-boot)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Spring Boot

A service built with Spring Boot.

- **Extends:** [Java](#java) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Kotlin

A service written in Kotlin.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Go

A service written in Go.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Node.js

A service on Node.js, written in JavaScript or TypeScript.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Python

A service written in Python.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [Django](#django), [FastAPI](#fastapi), [Flask](#flask)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Django

A service built with Django.

- **Extends:** [Python](#python) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## FastAPI

A service built with FastAPI.

- **Extends:** [Python](#python) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Flask

A service built with Flask.

- **Extends:** [Python](#python) › [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Ruby on Rails

A service built with Ruby on Rails.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## .NET

A service on .NET, written in C\#.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## PHP

A service written in PHP.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Rust

A service written in Rust.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Elixir

A service written in Elixir, on the Erlang VM.

- **Extends:** [Service](#service) › [Compute](#compute) › [Component](core.md#component)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Platform

Where a service runs, drawn as the platform: it answers like the service on it.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [VM](#vm), [Docker](#docker), [Kubernetes](#kubernetes), [Azure App Service](cloud.md#azure-app-service)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## VM

A virtual machine running the service.

- **Extends:** [Platform](#platform) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [AWS EC2](cloud.md#aws-ec2), [GCP Compute Engine](cloud.md#gcp-compute-engine), [Azure VM](cloud.md#azure-vm)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Docker

A container running the service.

- **Extends:** [Platform](#platform) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [AWS ECS](cloud.md#aws-ecs), [AWS Fargate](cloud.md#aws-fargate), [Azure Container Instances](cloud.md#azure-container-instances)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Kubernetes

Pods on a Kubernetes cluster running the service.

- **Extends:** [Platform](#platform) › [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [AWS EKS](cloud.md#aws-eks), [GCP GKE](cloud.md#gcp-gke), [Azure AKS](cloud.md#azure-aks)
- **Kind:** `service`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)

## Function

A serverless function: runs per request or event and scales to zero.

- **Extends:** [Compute](#compute) › [Component](core.md#component)
- **Extended by:** [AWS Lambda](cloud.md#aws-lambda), [GCP Cloud Functions](cloud.md#gcp-cloud-functions), [GCP Cloud Run](cloud.md#gcp-cloud-run), [GCP App Engine](cloud.md#gcp-app-engine), [Azure Functions](cloud.md#azure-functions), [Azure Logic Apps](cloud.md#azure-logic-apps), [Cloudflare Workers](cloud.md#cloudflare-workers)
- **Kind:** `function`
- **Protocol:** `HTTP`
- **Statuses:** 61 from [Compute](#compute)
- **Headers:** 69 from [Compute](#compute)
