import type { Problem } from '../types';

export const chat: Problem = {
  id: 'chat',
  title: 'Chat',
  difficulty: 'medium',
  tags: ['websocket', 'pub-sub', 'durability', 'presence'],
  statement: `Design one-to-one messaging for a chat app. Phones keep a WebSocket
open to the service while the app is in the foreground; when it is not, the
only way to reach the user is a push notification.

## Functional requirements

- **Send message**: the sender sends a message over their WebSocket and gets
  an ack with the message id. Model its two scenarios:
  - \`"Online"\`: the recipient has a connection open; the message is
    delivered over it within a second.
  - \`"Offline"\`: the recipient has no connection; they get a push
    notification instead and fetch the message when they open the app.
- **Load history**: a user opens a conversation and gets its last 50
  messages (\`200\`), on any device.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- 50M daily active users. **Send message: 10k rps** at peak; 70% of
  recipients are online at that moment.
- **Load history: 2k rps**.
- Connections are spread over many gateway servers: the sender and the
  recipient are almost never connected to the same one, so a message has to
  be routed between servers through a pub/sub broker.

## Constraints

- p99 of sending (until the ack) under **150 ms**, of loading history under
  **200 ms**.
- Sending available **99.95%** of the time.
- The ack is a promise: a message is never lost once the sender saw it.
- The ack never waits for delivery: neither for the push provider nor for
  the recipient's connection. Look up presence first, then deliver, both
  after the ack.
- Losing any single machine must not take the service down.
- At most **$4,000 / month**.

## What is given

\`problem.proschi\` declares the \`sender\` and the \`recipient\` and the
external \`push\` provider (APNs and FCM; about 200 ms per notification), and
holds the traffic, requirements and tests. Add the components, the
connections and the two use cases.`,
  given: `title "Chat" "One-to-one messages delivered in real time, or by push notification"

sender    "Sender"        [Actor]
recipient "Recipient"     [Actor]
push      "Push Provider" [Third Party API] "APNs and FCM"

capacity {
  push 10k rps
}

traffic {
  "Send message" 10k rps mix "Online" 70%, "Offline" 30%
  "Load history" 2k rps
}

requirements {
  p99 "Send message" < 150ms
  p99 "Load history" < 200ms
  availability "Send message" >= 99.95%
  durable "Send message"
  survive any node failure
  cost <= 4000 usd/month
}

test "Messages are stored before the ack, and history reads them back" {
  "Send message" writes any database before responding
  "Load history" calls any database
}

test "Presence decides how a message is delivered" {
  "Send message" calls any cache before recipient
  "Send message" calls any cache before push
}

test "Delivery happens after the ack" {
  "Send message" never waits for push or recipient
  "Send message" calls recipient after any database
}

test "Online recipients get the message over their connection" {
  "Send message" scenario "Online" calls any queue before recipient
  "Send message" scenario "Online" never calls push
}

test "Offline recipients get a push notification" {
  "Send message" scenario "Offline" calls push
  "Send message" scenario "Offline" never calls recipient
}
`,
  starter: `import "problem.proschi"

# Add the components, connections and the use cases "Send message" and "Load history".
ws "Chat Gateway" [WebSocket]

sender -> ws

usecase "Send message" {
  sender -> ws : SEND {"to": "bob", "text": "On my way"}
  ws --> sender : ACK {"id": "m_77"}
}
`,
  solution: `import "problem.proschi"

lb       "Load Balancer" [AWS Load Balancer] x2 @chat
ws       "Chat Gateway"  [WebSocket]         x13 @chat "Holds the WebSockets; stores and routes messages"
messages "Messages"      [Cassandra]         x2 @chat "Every message, partitioned by conversation"
presence "Presence"      [Redis]             x2 @chat "Which gateway each online user is connected to"
broker   "Message Bus"   [NATS]              x2 @chat "One subject per gateway server"
history  "History API"   [REST API]          x3 @chat "Pages through a conversation"

sender  -> lb
lb      -> ws        : WebSocket
lb      -> history   : HTTPS
ws      -> messages  : write
ws      -> presence  : lookup
ws      -> broker    : publish / subscribe
ws      -> recipient : WebSocket
ws      -> push      : notify
history -> messages  : read

entity Message in messages "One message in a conversation" {
  conversationId string key
  sentAt         time   key
  id             string unique
  senderId       string
  text           string
}

entity Presence in presence "Where a user is connected; expires 60 s after the last heartbeat" {
  userId  string key
  gateway string
}

decision "Store before the ack" {
  because "The ack promises the message is safe; once it is in Cassandra, delivery can be retried from there"
  rejected "Ack on receipt, store asynchronously" "A gateway crash would lose messages the sender already saw as sent"
}
decision "Cassandra for messages" {
  because "Append-heavy writes at 10k rps, and history is one partition per conversation read newest first"
  rejected "PostgreSQL" "A single primary and a growing table of billions of rows"
}
decision "Route between gateways with pub/sub" because "Each gateway subscribes to its own subject; presence says which subject reaches the recipient"
decision "Deliver after the ack" because "Delivery and push notifications (200 ms) never hold up the sender"

usecase "Send message" "Send a message to another user" {
  sender    -> lb       : SEND {"to": "bob", "text": "On my way"}
  lb        -> ws       : SEND
  ws        -> messages : INSERT Message m_77
  messages --> ws       : ok
  ws       --> lb       : ACK {"id": "m_77"}
  lb       --> sender   : ACK {"id": "m_77"}
  ws        -> presence : GET presence:bob

  alt "Online" when "the recipient has a WebSocket open" {
    presence --> ws        : gateway ws-7
    ws       ->> broker    : PUBLISH gateway.ws-7 m_77
    broker   ->> ws        : m_77 (on gateway ws-7)
    ws       ->> recipient : MESSAGE m_77
  } alt "Offline" when "the recipient has no connection" {
    presence --> ws   : nil
    ws       ->> push : notify bob "New message"
  }
}

usecase "Load history" "Show the last messages of a conversation" {
  sender    -> lb       : GET /conversations/c_12/messages?limit=50
  lb        -> history  : GET /conversations/c_12/messages?limit=50
  history   -> messages : SELECT Message WHERE conversationId = c_12 LIMIT 50
  messages --> history  : 50 messages
  history  --> lb       : 200 {"messages": [...]}
  lb       --> sender   : 200 {"messages": [...]}
}
`,
  hints: [
    'The ack is a promise. Which store must the message reach before the sender gets it, and which store can then serve the history?',
    'The recipient is connected to a different gateway server than the sender. Something has to know which one (presence) and carry the message there (pub/sub).',
    'Look up presence after storing: online means publish to the recipient\'s gateway, offline means a push notification. Do both after the ack (below the line that answers the sender, or with ->>), so the sender never waits for delivery.',
    'Every delivery to an online recipient also passes through a gateway: size the gateways for sends plus deliveries at well under 70% busy.',
  ],
};
