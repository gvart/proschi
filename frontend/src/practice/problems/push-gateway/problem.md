---
title: Push Gateway
summary: "Netflix's Zuul Push: persistent connections, a registry, and Kafka in between."
difficulty: medium
company: Netflix
tags: [websocket, queues, routing, real-world]
hints:
  - "Dozens of backend services want to push messages, and none of them should know which server holds a device's connection, or wait for it. What can take the message from them right away?"
  - "A push server only knows the connections it holds itself. Something has to say which server holds a given customer's connection: the push server writes that on every connect, and the message processor reads it before delivering."
  - "\"Deliver\" starts at Kafka: the processor reads the registry (GET), then calls only that push server, which writes the frame to the device. No record means the device is offline: drop the message. A record that points at a dead server is a failed call (-x push) in \"Stale route\"."
  - "The registry takes a write on every connect (5.5k a second) and a read on every message (20k a second), and needs record expiry. One PostgreSQL primary takes 5k writes; DynamoDB works but blows the budget. Netflix used Dynomite, which is Redis underneath. Size the push servers and processors at about 2k rps per replica, well under 70% busy."
---

Netflix apps on TVs, phones, game consoles and browsers used to poll the
cloud for new data. Zuul Push turned that around: every app keeps one
persistent WebSocket or SSE connection open to a fleet of push servers, and
backend services push messages, such as fresh recommendations, down those
connections when they have something to say.

The hard part is not one connection but millions of them, spread over a
fleet of servers, and many senders that must not care which server holds
which device. Design the routing between them.

## Functional requirements

- **Connect**: a device opens its push connection through a load balancer to
  one of the push servers. The push server authenticates it and records in
  the **push registry** that this customer is connected to this server,
  with an expiry, then answers `101 Switching Protocols`.
- **Send**: a backend service pushes a message for a customer with a
  one-line call to a push library and gets an acknowledgement as soon as
  the message is accepted. The senders never talk to push servers.
- **Deliver**: a message processor takes a message from the queue, looks
  the customer up in the registry and hands the message to the push server
  holding the connection, which writes it to the device. Three scenarios:
  - `"Online"`: the registry names a server and the device gets the
    message.
  - `"Offline"`: the registry has no record; the message is dropped (push
    is best effort, and the app fetches fresh data when it next connects).
  - `"Stale route"`: the record points to a push server that went away
    with its connections; the call fails and the message is dropped.

Name the push servers `push` and the registry `registry`: the tests in
`problem.proschi` refer to them, and to the use case and scenario names
above.

## Scale

- About **10 million** devices connected to this cluster at once. A
  connection lives at most about 30 minutes before the client reconnects
  (randomly spread so they do not all reconnect at once), so about **5.5k
  connects per second**.
- **20k messages per second** pushed at peak; 60% of them find their
  customer connected, 38% do not, and 2% find a stale record.

## Constraints

- Senders only hand a message over; they never wait for the registry or a
  push server, and have no connection to the push servers.
- p99 of **Send** under **30 ms**, of **Connect** under **60 ms**, and of
  **Deliver** in the `"Online"` scenario under **100 ms**.
- **Send** available **99.99%** of the time, **Connect** **99.9%**.
- An accepted message is stored durably before the sender hears back.
- Losing any single machine must not stop connecting or pushing.
- At most **$5,000 / month**, the backend services included.

The simulation counts requests, not open sockets: it cannot tell how many
connections a push server holds, or model the herd of reconnects when one
dies. Size the push servers by the requests they handle.

## What is given

`problem.proschi` declares the `device` and `senders`, the backend services
that push messages, and holds the traffic, requirements and tests. Add the
load balancer, the push servers, the registry, the queue, the message
processors, the connections and the three use cases.

Unlike **Chat**, nothing here is stored for later: the problem is finding
the one server, among many, that holds a device's connection.

## Based on

- Susheel Aroskar, [Scaling Push Messaging for Millions of Devices @Netflix](https://www.infoq.com/presentations/neflix-push-messaging-scale/),
  QCon New York 2018 ([summary on InfoQ](https://www.infoq.com/news/2018/07/zuul-push-messaging/)):
  persistent WebSocket and SSE connections to Netty-based Zuul Push
  servers, a push registry in Dynomite (Redis with sharding and
  replication), a push library that writes to a Kafka queue, message
  processors that look the customer up and deliver or drop the message,
  5.5 million connected clients at the time, and auto-scaling by open
  connections.
- [Push Messaging](https://github.com/Netflix/zuul/wiki/Push-Messaging),
  the Zuul wiki: the two-step lookup (a global registry, then each server's
  in-memory registry), what the registry needs (low read latency, record
  expiry, sharding, replication), a registry TTL of 1,800 seconds, and the
  randomised reconnect window.
- Netflix Technology Blog, [Pushy to the Limit: Evolving Netflix's WebSocket proxy for the future](https://netflixtechblog.com/pushy-to-the-limit-evolving-netflixs-websocket-proxy-for-the-future-b468bc0ff658),
  2024: the same design years later, at hundreds of millions of concurrent
  connections and up to 300,000 messages a second.
