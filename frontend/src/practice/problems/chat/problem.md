---
title: Chat
summary: Store before the ack, then deliver over pub/sub or push.
difficulty: medium
tags: [websocket, pub-sub, durability, presence]
hints:
  - The ack is a promise. Which store must the message reach before the sender gets it, and which store can then serve the history?
  - The recipient is connected to a different gateway server than the sender. Something has to know which one (presence) and carry the message there (pub/sub).
  - "Look up presence after storing: online means publish to the recipient's gateway, offline means a push notification. Do both after the ack (below the line that answers the sender, or with ->>), so the sender never waits for delivery."
  - "Every delivery to an online recipient also passes through a gateway: size the gateways for sends plus deliveries at well under 70% busy."
---

Design one-to-one messaging for a chat app. Phones keep a WebSocket
open to the service while the app is in the foreground; when it is not, the
only way to reach the user is a push notification.

## Functional requirements

- **Send message**: the sender sends a message over their WebSocket and gets
  an ack with the message id. Model its two scenarios:
  - `"Online"`: the recipient has a connection open; the message is
    delivered over it within a second.
  - `"Offline"`: the recipient has no connection; they get a push
    notification instead and fetch the message when they open the app.
- **Load history**: a user opens a conversation and gets its last 50
  messages (`200`), on any device.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- 50M daily active users. **Send message: 10k rps** at peak; 70% of
  recipients are online at that moment.
- **Load history: 2k rps**.
- Connections are spread over many gateway servers: the sender and the
  recipient are almost never connected to the same one, so a message has to
  be routed between servers through a pub/sub broker.

## Constraints

- p99 of sending (until the ack) under **100 ms**, of loading history under
  **200 ms**.
- Sending available **99.95%** of the time.
- The ack is a promise: a message is never lost once the sender saw it.
- The ack never waits for delivery: neither for the push provider nor for
  the recipient's connection. Look up presence first, then deliver, both
  after the ack.
- Losing any single machine must not take the service down.
- At most **$4,000 / month**.

## What is given

`problem.proschi` declares the `sender` and the `recipient` and the
external `push` provider (APNs and FCM; about 200 ms per notification), and
holds the traffic, requirements and tests. Add the components, the
connections and the two use cases.
