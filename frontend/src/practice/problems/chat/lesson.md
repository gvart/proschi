# Chat: store before the ack, deliver after it

One-to-one chat is a favourite interview problem because it mixes three ideas that each look simple alone: a durable write, a long-lived connection, and routing a message to whichever server the recipient happens to be connected to. Get the order wrong and you either lose messages or make every sender wait for the slowest phone on the network. This lesson builds the design in the right order.

## What you'll learn

- What an ack promises, and why the message must reach durable storage before the sender sees it.
- How WebSockets keep a connection open, and why that makes gateways stateful.
- How presence plus pub/sub routes a message to the gateway that holds the recipient's connection.
- Why delivery (online or by push notification) happens after the ack, never before.
- How to pick a store for an append-heavy, read-recent workload.

## The problem, explained

**Who uses it.** 50 million daily active users on phones. While the app is in the foreground, it keeps a WebSocket open to the service. When it is in the background, the only way to reach the user is a push notification through APNs or FCM.

**Functional requirements.**

- **Send message**: the sender sends over their WebSocket and gets an ack with the message id. Two scenarios: `"Online"` (the recipient has a connection open and gets the message over it within a second) and `"Offline"` (the recipient gets a push notification and fetches the message when they open the app).
- **Load history**: a user opens a conversation and gets the last 50 messages, `200`, on any device.

**Non-functional requirements.** p99 (the latency that 99% of requests beat) under 100 ms from send to ack, and under 200 ms for history. Sending available 99.95%. A message is never lost once the sender saw the ack. The ack never waits for delivery: neither for the push provider nor for the recipient's connection. After the ack, the service looks up presence first and then delivers the message. Any single machine can fail. At most $4,000 a month.

**What is given, and why.** `given.proschi` declares the `sender`, the `recipient` and the external `push` provider, with a capacity of 10k notifications a second and roughly 200 ms per call. Everything between them is yours to design.

**What the tests check.**

- *Messages are stored before the ack, and history reads them back*: Send message writes a database before responding, and Load history reads a database.
- *Presence decides how a message is delivered*: Send message calls a cache before reaching the recipient and before calling push.
- *Delivery happens after the ack*: Send message never waits for push or the recipient, and reaches the recipient only after the database write.
- *Online recipients get the message over their connection*: in `"Online"`, a queue (the pub/sub broker) comes before the recipient, and push is never called.
- *Offline recipients get a push notification*: `"Offline"` calls push and never the recipient.

## Back-of-the-envelope

| Quantity | Arithmetic | Result |
|---|---|---|
| Sends | given | 10k rps |
| Online deliveries via pub/sub | 70% × 10k | 7k rps |
| Push notifications | 30% × 10k | 3k rps (provider limit 10k) |
| Presence lookups | one per send | 10k rps |
| Message writes | one per send | 10k rps |
| Gateway work | 10k sends + 7k deliveries | 17k rps |
| History reads | given | 2k rps |
| Messages per day, upper bound | 10k/s × 86,400 s | 864M |
| Storage per day (assume ~200 bytes each) | 864M × 200 B | about 170 GB/day, about 63 TB/year |

The storage line is an upper bound (the peak rate held all day) with an assumed message size, but it shows the shape: data grows forever, writes are constant, and reads are for recent messages in one conversation.

**Gateways do two jobs.** A gateway receives the sender's message *and* delivers messages to the users connected to it. Every online delivery passes through a gateway a second time. In Proschi, a service replica handles 2k requests a second, so 17k rps needs 8.5 replicas at 100%. Divide by a 70% target and check that one replica fewer still stays under 100%.

**The store must take 10k writes a second.** A relational database in the model is single-primary: 5k writes a second per shard, whatever the replica count. 10k writes would saturate it unless you shard it. A partitioned store like Cassandra accepts writes on every replica, 20k a second each, so two replicas are lightly loaded. Real chat systems (Discord is the famous write-up) chose wide-column stores for exactly this append-heavy, partition-by-conversation pattern.

**Latency.** The ack path is load balancer → gateway → message store → ack: a 2 ms hop, a 10 ms gateway, a 5 ms write, plus queueing and tails. That fits 100 ms easily. Adding the push provider (about 200 ms) before the ack would not.

**Connections, not just requests.** The model counts requests per second. A real gateway is also sized by open connections and memory per connection. With tens of millions of users online at peak, you need enough gateway servers to hold them all; mention it, even though the simulation does not count it.

**Cost.** Service replicas $100, a load balancer $50, a Redis replica $150, a queue or broker replica $200, a Cassandra replica $500. With $4,000, every tier needs to be sized, not padded.

## Concepts

### The ack is a promise: store first

An *ack* (acknowledgement) tells the sender "your message is safe". The only honest way to say that is after the message is in durable, replicated storage. If you ack on receipt and store later, a gateway crash between the two loses messages the sender believes were sent, and nothing can recover them.

Once the message is stored, everything else can be retried: delivery to the recipient, the push notification, syncing to the sender's other devices. The store becomes the *source of truth*; connections and notifications are just ways of telling people to look.

The trade-off is that the ack waits for one database write. With a store designed for fast appends, that is a few milliseconds. When not to do this: ephemeral signals such as "typing…" indicators, which are fine to lose and should never touch the database.

```proschi
title "Durable comments"

reader "Reader"        [Actor]
api    "Comments API"  [REST API]  x2
store  "Comment Store" [Cassandra] x2
fanout "Comment Bus"   [Kafka]     x2

reader -> api    : HTTPS
api    -> store  : write
api    -> fanout : publish

usecase "Post comment" {
  reader -> api    : POST /threads/5/comments
  api    -> store  : INSERT comment c_9
  store --> api    : ok
  api   --> reader : 201 {"id": "c_9"}
  api   ->> fanout : CommentPosted c_9
}
```

### WebSockets and stateful gateways

HTTP is request/response: the client asks, the server answers. For chat, the server needs to talk first. A *WebSocket* (RFC 6455) starts as an HTTP request, upgrades to a long-lived, two-way connection over TCP, and lets either side send messages at any time.

That changes the servers. A *gateway* that holds WebSockets is *stateful*: user Bob is connected to gateway 7, not to "the service". Losing gateway 7 drops Bob's connection (his app reconnects to another gateway), and anyone who wants to reach Bob must know he is on gateway 7. Load balancers must support long-lived connections, and deploys must drain connections gradually.

Alternatives: *long polling* (the client keeps a request open until the server has something, then re-opens it) works everywhere but costs a request per message; *server-sent events* push one way only. When not to use WebSockets: for occasional updates where a push notification or a periodic poll is enough.

### Presence and pub/sub routing

The sender is on gateway 3, the recipient on gateway 7. Two pieces get the message across:

- **Presence**: a fast key-value store (Redis) mapping user id to the gateway holding their connection, written when a user connects and kept alive by heartbeats with a short expiry. Lookup answers two questions at once: *is the user online?* and *where?*
- **Pub/sub**: a message bus (NATS, Redis pub/sub, Kafka) where each gateway subscribes to its own subject. To reach Bob, publish to `gateway.7`; gateway 7 receives it and writes it to Bob's socket.

If presence says nobody is connected, send a push notification instead. Presence can be slightly stale (a phone that just lost signal still looks online for a few seconds), which is fine because the message is already stored: the recipient fetches it on the next app open, and clients deduplicate by message id.

Trade-offs: presence is one more store to keep available, and very large group chats need a different design (fan-out to many gateways). Slack's real-time messaging architecture uses the same split: gateway servers hold the client connections, and separate servers track presence.

```proschi
title "Live scores"

source   "Match Data"  [Third Party API]
feed     "Score Feed"  [Worker]          x2
registry "Who Watches" [Redis]           x2
bus      "Score Bus"   [NATS]            x2
edge     "Socket Edge" [WebSocket]       x3
fan      "Fan"         [Actor]

source -> feed     : webhook
feed   -> registry : lookup
feed   -> bus      : publish
bus    -> edge     : deliver
edge   -> fan      : WebSocket

usecase "Goal scored" {
  source    -> feed     : GoalScored match 12
  feed      -> registry : GET watchers:match12
  registry --> feed     : edge-2
  feed     ->> bus      : PUBLISH edge.2 goal
  bus      ->> edge     : goal (on edge-2)
  edge     ->> fan      : SCORE 1-0
}
```

## Designing it step by step

**1. Scope.** Ask: one-to-one only, or groups (one-to-one here)? Delivery guarantees (never lose after ack; at-least-once delivery, where a message may arrive twice but never zero times, with deduplication on the client is fine)? Ordering (per conversation, by time)? Multi-device (history must work on any device)? Read receipts, typing indicators, media (out of scope, but name them)? Confirm the numbers: 10k sends a second, 70% of recipients online, 2k history loads a second.

**2. High-level design.** Draw three paths.

- *Write path*: sender → load balancer → gateway → message store → ack.
- *Delivery path*, after the ack: gateway → presence lookup → either pub/sub broker → recipient's gateway → recipient, or the push provider.
- *History path*: user → load balancer → a history API → message store.

Explain why history goes through a separate stateless API: it is ordinary request/response and should not occupy gateway capacity reserved for live traffic.

**3. Deep dive.**

- *Ordering of steps.* Store, then ack, then presence, then deliver. In Proschi, either put the delivery steps after the line that answers the sender, or use async arrows (`->>`); both keep them off the critical path. Use `alt "Online"` and `alt "Offline"` after the presence lookup, with exactly those names.
- *The store.* Partition messages by conversation, cluster by time, so "last 50 messages" is one partition read newest-first. Explain why a single-primary relational database would need sharding at 10k writes a second.
- *Sizing.* Gateways for sends plus deliveries; presence, broker, store and load balancer with at least two replicas; history for 2k rps with headroom.
- *Failure.* A gateway dies: its users reconnect elsewhere and re-register presence; messages in flight are already stored and will be fetched. The broker loses a node: the survivors carry it.

**4. Wrap-up.** Walk the requirements: the ack follows the write; delivery is after the ack in both scenarios; no single replica anywhere; the budget fits. Then mention extensions: message ids generated with a time-ordered id scheme, delivery and read receipts as messages in the reverse direction, group chats with a per-group fan-out, end-to-end encryption, and syncing a user's other devices by having every device of a user subscribe through presence.

## Common mistakes

**Delivering before the ack** (`wrong/deliver-before-ack`). The gateway stores the message, then publishes it, waits for the recipient's connection to confirm, and only then acks the sender. It feels "more correct", because the ack now means "delivered". But the sender's latency is now tied to the recipient's phone, which might be on a slow mobile network, and a stuck connection stalls the sender. In the model the recipient is an actor with no latency, so p99 only rises from about 51 ms to about 64 ms and stays under the limit: the numbers alone do not catch it. The flow test does: it fails *Delivery happens after the ack*. A good reminder that the model is optimistic about clients you do not control.

**Other classic mistakes.**

- *Ack on receipt, store asynchronously.* The fastest ack, and the one that loses messages in a crash. Fails *Messages are stored before the ack, and history reads them back* and `durable "Send message"`.
- *Sending push to everyone, online or not.* Users get a notification for a message already on their screen, and push volume more than triples. Fails *Online recipients get the message over their connection*.
- *Delivering without a presence lookup* (broadcasting to every gateway). Every gateway processes every message: cost grows with the number of gateways. Fails *Presence decides how a message is delivered*.
- *PostgreSQL without shards for messages.* 10k writes a second on a 5k-writes primary saturates it, and `p99 "Send message"` fails because a saturated node fails every latency requirement that loads it.
- *Gateways sized for sends only.* Forgetting the 7k deliveries leaves them far hotter than planned, and too hot with one replica lost.

## In the interview

Open with the ordering, because it is the crux: "Store, ack, then deliver. The ack is a durability promise, not a delivery promise." Then draw the gateway, presence and broker, and trace one message through `"Online"` and one through `"Offline"`.

Likely follow-ups, with short answers:

- *How do you guarantee ordering?* Order by a per-conversation, time-ordered message id assigned at write time; clients sort by it and fill gaps from history.
- *What if the recipient's gateway dies mid-delivery?* The message is stored; on reconnect the client asks for everything after its last seen id.
- *Duplicates?* Delivery is at-least-once; clients deduplicate by message id.
- *How do group chats change this?* Look up presence for all members, group them by gateway, publish once per gateway. Very large groups switch to members pulling from a channel stream.
- *How do you scale presence?* It is a key-value store with short expiries, sharded by user id; heartbeats every so often keep keys alive.
- *Multiple devices per user?* Presence maps a user to several connections; deliver to all of them, push to the ones that are offline.
- *Why not long polling?* It works and is simpler behind some proxies, but it costs a request per message and adds latency; WebSockets are the default for chat.

## Further reading

- [Real-time Messaging](https://slack.engineering/real-time-messaging/), Slack Engineering, 2023: channel servers, gateway servers and presence servers in Slack's architecture.
- [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages), Discord: why they moved message storage to Cassandra and how they partition it.
- [RFC 6455: The WebSocket Protocol](https://datatracker.ietf.org/doc/rfc6455), IETF, 2011: the opening handshake and framing behind every chat connection.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Architecture section links Riot Games' chat service and LinkedIn's real-time presence platform.
- [awesome-system-design-resources](https://github.com/ashishps1/awesome-system-design-resources): includes "Design WhatsApp" among its interview problems and a "Long Polling vs WebSockets" article.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Chat System".
