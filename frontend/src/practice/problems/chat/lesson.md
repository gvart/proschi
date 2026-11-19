# Chat: store before the ack, deliver after it

```tldr
**Store, ack, then deliver.** The ack is a **durability** promise, so the message reaches a replicated store before the sender sees it; delivery comes after. **Presence** says whether the recipient is online and on which gateway, **pub/sub** carries the message there, and offline users get a **push notification**. Size the gateways for sends *and* deliveries (10k + 7k = 17k rps) and the store for **10k writes a second**.
```

One-to-one chat mixes three ideas that each look simple alone: a durable write, a long-lived connection, and routing a message to whichever server holds the recipient. Get the order wrong and you either lose messages or make every sender wait for the slowest phone on the network.

## What you'll learn

- What an ack promises, and why the message must reach durable storage before the sender sees it.
- How WebSockets keep a connection open, and why that makes gateways stateful.
- How presence plus pub/sub routes a message to the gateway that holds the recipient's connection.
- Why delivery (online or by push notification) happens after the ack, never before.
- How to pick a store for an append-heavy, read-recent workload.

## The problem, explained

**Who uses it.** 50 million daily active users on phones. In the foreground the app keeps a WebSocket open to the service; in the background the only way to reach the user is a push notification through APNs or FCM.

**Functional requirements.**

- **Send message**: the sender sends over their WebSocket and gets an ack with the message id. Two scenarios: `"Online"` (the recipient has a connection open and gets the message over it within a second) and `"Offline"` (the recipient gets a push notification and fetches the message when they open the app).
- **Load history**: a user opens a conversation and gets the last 50 messages, `200`, on any device.

**Non-functional requirements.**

| Requirement | Target |
|---|---|
| p99 (the latency 99% of requests beat) | Send to ack under 100 ms, history under 200 ms |
| Availability | Sending 99.95% |
| Durability | A message is never lost once the sender saw the ack |
| Ordering | The ack never waits for delivery (push provider or recipient); after the ack, look up presence, then deliver |
| Fault tolerance | Any single machine can fail |
| Budget | At most $4,000 a month |

**What is given, and why.** `given.proschi` declares the `sender`, the `recipient` and the external `push` provider, with a capacity of 10k notifications a second and roughly 200 ms per call. Everything between them is yours.

**What the tests check.**

- *Messages are stored before the ack, and history reads them back*: Send message writes a database before responding, and Load history reads a database.
- *Presence decides how a message is delivered*: Send message reads a cache (`GET`) before reaching the recipient and before calling push.
- *Delivery happens after the ack*: Send message never waits for push or the recipient, and reaches the recipient only after the database write.
- *Online recipients get the message over their connection*: in `"Online"`, a queue (the pub/sub broker) comes before the recipient, and push is never called.
- *Offline recipients get a push notification*: `"Offline"` calls push and never the recipient.

## Back-of-the-envelope

```numbers
10k rps | sends, each one write and one presence lookup
17k rps | gateway work (sends + deliveries)
3k rps | push notifications (limit 10k)
≈ 290 GB/day | messages stored (1 KB each, average a third of peak)
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Sends | given | 10k rps |
| Online deliveries via pub/sub | 70% × 10k | 7k rps |
| Push notifications | 30% × 10k | 3k rps (provider limit 10k) |
| Presence lookups | one per send | 10k rps |
| Message writes | one per send | 10k rps |
| Gateway work | 10k sends + 7k deliveries | 17k rps |
| History reads | given | 2k rps |
| Messages per day (assume the average is a third of the peak) | 10k/s ÷ 3 × 86,400 s | about 290M |
| Storage per day (assume ~1 KB stored per message) | 290M × 1 KB | about 290 GB/day, about 100 TB/year |

The storage line rests on two assumptions (the statement gives neither the average rate nor a message size), but it shows the shape: data grows forever, writes never stop, and reads want the recent messages of one conversation.

**Gateways do two jobs.** A message to an online recipient touches the gateway tier twice: once on the way in (the sender's gateway) and once on the way out (the recipient's gateway). That is 10k sends plus 7k deliveries. At 2k requests a second per service replica, 17k rps needs 8.5 replicas at 100%; divide by a 70% target, and check that the tier still copes with one replica lost.

**The store must take 10k writes a second.** A modelled relational database has one primary that takes every write: 5k writes a second per shard, however many read replicas you add, so 10k saturates it unless you shard. Cassandra is a *wide-column store* (rows grouped into partitions by a key, sorted inside each partition) in which every replica accepts writes, 20k a second each in the model, so two are lightly loaded. Real chat systems chose such stores for this append-heavy, partition-by-conversation pattern; Discord's write-up is the famous one.

**Latency.** The ack path is load balancer → gateway → message store → ack: a 2 ms hop, a 10 ms gateway, a 5 ms write, plus queueing and tails. That fits 100 ms easily. One 200 ms call to the push provider before the ack would not.

**Connections, not just requests.** A real gateway is also sized by open connections and memory per connection. With tens of millions online at peak you need enough gateways to hold them all: mention it, though the simulation counts only requests.

**Cost.** Service replicas $100, a load balancer $50, a Redis replica $150, a queue or broker replica $200, a Cassandra replica $500. With $4,000, every tier is sized, not padded.

```quiz
websocket-servers-needed
```

## Concepts

### The ack is a promise: store first

An *ack* (acknowledgement) tells the sender "your message is safe", which is only honest once the message is in durable, replicated storage. Ack on receipt and store later, and a gateway crash between the two loses messages the sender believes were sent.

Once stored, everything else can be retried: delivery, the push notification, syncing the sender's other devices. The store is the *source of truth*; connections and notifications are just ways of telling people to look.

The cost is one database write before the ack: a few milliseconds on a store built for appends. Ephemeral signals such as "typing…" indicators are the exception: fine to lose, they never touch the database.

```callout takeaway
The ack is a **durability** promise, not a delivery promise.
```

````deepdive The same order in Proschi
Store, answer, then publish asynchronously, here for comments on a thread:

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
````

```quiz
ack-after-store
```

### WebSockets and stateful gateways

Chat needs the server to talk first, which plain request/response HTTP cannot. A *WebSocket* (RFC 6455) starts as an HTTP request and upgrades to a long-lived, two-way TCP connection where either side sends at any time.

That makes a gateway *stateful*: Bob is connected to gateway 7, not to "the service". Losing it drops his connection (his app reconnects elsewhere), and anyone reaching Bob must know where he is. Load balancers must support long-lived connections, and deploys must drain them gradually.

| Option | How | Cost |
|---|---|---|
| **WebSocket** | One long-lived, two-way connection | Stateful servers; the default for chat |
| **Long polling** | The client holds a request open until there is news, then re-opens it | Works everywhere, but a request per message |
| **Server-sent events** | A long-lived HTTP stream | Server to client only |

Skip WebSockets for occasional updates, where a push notification or a periodic poll is enough.

### Presence and pub/sub routing

The sender is on gateway 3, the recipient on gateway 7. Two pieces get the message across:

- **Presence**: a fast key-value store (Redis) mapping user id to the gateway holding their connection, written on connect and kept alive by heartbeats with a short expiry. One lookup answers *is the user online?* and *where?*
- **Pub/sub**: a message bus (NATS, Redis pub/sub, Kafka) where each gateway subscribes to its own subject. To reach Bob, publish to `gateway.7`; gateway 7 writes it to Bob's socket.

If nobody is connected, send a push notification instead. Presence can be stale: a phone that just lost signal looks online until its key expires. That is fine, because the message is stored: the app fetches it when it next opens and deduplicates by message id. Real systems also send the push when the recipient's device does not confirm the delivery.

Trade-offs: presence is one more store to keep available, and very large groups need fan-out to many gateways. Slack's real-time messaging uses the same split: gateway servers hold connections, separate servers track presence.

````deepdive Presence and pub/sub in Proschi
Live sports scores use the same lookup-then-publish shape:

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
````

```quiz
routing-to-a-websocket
push-when-offline
```

## Designing it step by step

**1. Scope.** Ask: one-to-one or groups (one-to-one)? Guarantees (never lost after the ack; delivered *at least once*, so a message may arrive twice but never zero times, and the client deduplicates)? Ordering (per conversation, by time)? Multi-device (history anywhere)? Receipts, typing indicators, media (out of scope; name them)? Confirm 10k sends a second, 70% of recipients online, 2k history loads a second.

**2. High-level design.** Draw three paths.

- *Write path*: sender → load balancer → gateway → message store → ack.
- *Delivery path*, after the ack: gateway → presence lookup → either pub/sub broker → recipient's gateway → recipient, or the push provider.
- *History path*: user → load balancer → a history API → message store.

History uses a separate stateless API: it is ordinary request/response and should not take gateway capacity meant for live traffic.

**3. Deep dive.**

- *Ordering of steps.* Store, ack, presence, deliver. In Proschi, put delivery after the line that answers the sender, or use async arrows (`->>`): both keep it off the critical path. Use `alt "Online"` and `alt "Offline"`, exactly so named, after the presence lookup.
- *The store.* Partition by conversation, cluster by time, so "last 50 messages" is one partition read newest-first. Explain why a single-primary relational database needs sharding at 10k writes a second.
- *Sizing.* Gateways for sends plus deliveries; presence, broker, store and load balancer with at least two replicas; history for 2k rps with headroom.
- *Failure.* A dead gateway's users reconnect elsewhere and re-register presence; in-flight messages are stored and will be fetched. A lost broker node is carried by the survivors.

**4. Wrap-up.** Walk the requirements: the ack follows the write; delivery follows the ack in both scenarios; nothing is single; the budget fits. Then extensions: time-ordered message ids, delivery and read receipts as reverse-direction messages, groups with per-group fan-out, end-to-end encryption, and syncing a user's other devices by listing every connected device in presence and delivering to each.

## Common mistakes

**Delivering before the ack** (`wrong/deliver-before-ack`). The gateway stores the message, publishes it, waits for the recipient's connection to confirm, then acks. It feels "more correct" (the ack means "delivered"), but the sender now waits on the recipient's phone, perhaps on a slow network, and a stuck connection stalls them. It fails *Delivery happens after the ack*.

```callout pitfall The numbers alone do not catch it
In the model the recipient is an actor with no latency, so p99 only rises from about 51 ms to about 64 ms and stays under the limit. The model is optimistic about clients you do not control.
```

**Other classic mistakes.**

- *Ack on receipt, store asynchronously.* The fastest ack, and the one that loses messages in a crash. Fails *Messages are stored before the ack, and history reads them back* and `durable "Send message"`.
- *Sending push to everyone, online or not.* Notifications for messages already on screen, and push volume more than triples. Fails *Online recipients get the message over their connection*.
- *Delivering without a presence lookup* (broadcasting to every gateway). Every gateway processes every message: cost grows with the gateway count. Fails *Presence decides how a message is delivered*.
- *PostgreSQL without shards for messages.* 10k writes a second on a 5k-writes primary saturates it, and `p99 "Send message"` fails, because a saturated node fails every latency requirement that loads it.
- *Gateways sized for sends only.* Forgetting the 7k deliveries makes them 70% busier than planned (17k instead of 10k), and too hot with one replica lost.

## In the interview

```callout interview Open with the ordering
"Store, ack, then deliver. The ack is a durability promise, not a delivery promise." That is the crux. Then draw the gateway, presence and broker, and trace one message through `"Online"` and one through `"Offline"`.
```

Likely follow-ups, with short answers:

- *How do you guarantee ordering?* Order by a per-conversation, time-ordered message id assigned at write time; clients sort by it and fill gaps from history.
- *What if the recipient's gateway dies mid-delivery?* The message is stored; on reconnect the client asks for everything after its last seen id.
- *Duplicates?* Delivery is at-least-once; clients deduplicate by message id.
- *How do group chats change this?* Look up presence for all members, group them by gateway, publish once per gateway. Very large groups switch to members pulling from a channel stream.
- *How do you scale presence?* A key-value store with short expiries, sharded by user id; periodic heartbeats keep keys alive.
- *Multiple devices per user?* Presence maps a user to several connections; deliver to all of them, push to the offline ones.
- *Why not long polling?* It works and is simpler behind some proxies, but costs a request per message and adds latency; WebSockets are the chat default.

## Further reading

- [Real-time Messaging](https://slack.engineering/real-time-messaging/), Slack Engineering, 2023: channel servers, gateway servers and presence servers in Slack's architecture.
- [How Discord Stores Billions of Messages](https://discord.com/blog/how-discord-stores-billions-of-messages), Discord: why they moved message storage to Cassandra and how they partition it.
- [RFC 6455: The WebSocket Protocol](https://datatracker.ietf.org/doc/rfc6455), IETF, 2011: the opening handshake and framing behind every chat connection.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): its Architecture section links Riot Games' chat service and LinkedIn's real-time presence platform.
- [awesome-system-design-resources](https://github.com/ashishps1/awesome-system-design-resources): includes "Design WhatsApp" among its interview problems and a "Long Polling vs WebSockets" article.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design a Chat System".
