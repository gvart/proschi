import type { Problem } from '../types';

export const notificationFanout: Problem = {
  id: 'notification-fanout',
  title: 'Notification Fan-out',
  difficulty: 'medium',
  tags: ['queues', 'async', 'external-providers', 'failover'],
  statement: `The Order Service wants to tell customers when their order ships,
is delayed or arrives. Build the notification system it hands these events
to: it picks the channel each customer wants and sends the message through
an external email, SMS or push provider.

## Functional requirements

- **Notify**: the Order Service emits an event (\`OrderShipped\`, …) for a
  user. The user's preferences decide the channel; each event becomes at most
  one notification. Model five scenarios:
  - \`"Email"\`, \`"Push"\`, \`"SMS"\`: the user prefers that channel and the
    notification goes out through its provider.
  - \`"SMS failover"\`: the SMS provider does not answer; the message goes
    out through the backup SMS provider instead.
  - \`"Opted out"\`: the user turned these notifications off; nothing is
    sent.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- **1,500 events per second** at peak (evening delivery rounds).
- 55% of users prefer email, 30% push, 10% SMS; 4% opted out. The SMS
  provider times out on about 1% of all events.
- Providers are slow and flaky: about **200 ms** per call when they work,
  and they have outages.

## Constraints

- The Order Service must never wait for a provider: handing over an event
  takes under **50 ms** at p99.
- Accepting events available **99.95%** of the time.
- An accepted event is never lost, even if every provider is down for a
  while.
- Losing any single machine, or the SMS provider, must not stop
  notifications.
- At most **$2,000 / month**, the Order Service and the Preferences service
  included.

## What is given

\`problem.proschi\` declares the \`orders\` service (the caller), the existing
\`prefs\` service (each user's channel and opt-outs) and the providers
\`email\`, \`sms\`, \`smsBackup\` and \`push\`, with their rate limits. It also
holds the traffic, requirements and tests. Add the components, the
connections and the use case.`,
  given: `title "Notification Fan-out" "Turns order events into email, SMS and push notifications"

orders    "Order Service"       [REST API] x4 @orders   "Emits events when an order ships, is delayed or arrives"
prefs     "Preferences"         [REST API] x3 @accounts "Each user's channel and opt-outs; already exists"
email     "Email Provider"      [Email Service]
sms       "SMS Provider"        [SMS Service]
smsBackup "Backup SMS Provider" [SMS Service]
push      "Push Provider"       [Third Party API] "APNs and FCM"

capacity {
  email     2k rps
  sms       500 rps
  smsBackup 500 rps
  push      10k rps
}

traffic {
  "Notify" 1500 rps mix "Email" 55%, "Push" 30%, "SMS" 10%, "SMS failover" 1%, "Opted out" 4%
}

requirements {
  p99 "Notify" < 50ms
  availability "Notify" >= 99.95%
  durable "Notify"
  survive any node failure
  survive failure of sms
  cost <= 2000 usd/month
}

test "The Order Service never waits for a provider" {
  "Notify" calls any queue before any external
  no path from orders to any external
}

test "Preferences are checked before anything is sent" {
  "Notify" calls prefs before any external
  "Notify" scenario "Opted out" never calls any external
}

test "Each channel goes out through its provider" {
  "Notify" scenario "Email" calls email
  "Notify" scenario "Push" calls push
  "Notify" scenario "SMS" calls sms
}

test "SMS fails over to the backup provider" {
  "Notify" handles failure of sms
  "Notify" scenario "SMS failover" calls smsBackup
}
`,
  starter: `import "problem.proschi"

# Add the components, connections and the use case "Notify" with its five scenarios.
notifier "Notifier" [REST API]

orders   -> notifier
notifier -> email

usecase "Notify" {
  orders    -> notifier : OrderShipped {"userId": 42, "orderId": 981}
  notifier  -> email    : send "Your order is on its way"
  email    --> notifier : 202
  notifier --> orders   : 200
}
`,
  solution: `import "problem.proschi"

events "Notification Queue"  [AWS SQS]  x2 @notify "Accepted events; redelivered until a worker deletes them"
worker "Notification Worker" [REST API] x3 @notify "Checks preferences and calls the providers"

orders -> events    : SendMessage
events -> worker    : deliver
worker -> prefs     : HTTPS
worker -> email     : send
worker -> sms       : send
worker -> smsBackup : send
worker -> push      : send

entity NotificationEvent in events "One event to turn into a notification" {
  id     string key
  userId string
  type   string
  data   json
}

decision "Hand events over through a queue" {
  because "Providers take ~200 ms and fail; the Order Service only waits for SQS to store the event (~5 ms)"
  rejected "Call the providers from the Order Service" "Every order update would wait for, and fail with, a third party"
}
decision "Fail over SMS to a second provider" {
  because "SMS has no other route to the user; a timeout on the primary is retried once on the backup"
  rejected "Retry the primary only" "During an outage every SMS waits in the queue until the provider is back"
}
decision "At-least-once delivery" because "A worker deletes the event only after a provider accepted it; the event id is the provider's idempotency key, so a redelivered event is not sent twice"

usecase "Notify" "Turn an event into a notification on the user's channel" {
  orders  -> events : OrderShipped {"userId": 42, "orderId": 981}
  events --> orders : 200 queued
  events ->> worker : OrderShipped
  worker  -> prefs  : GET /users/42/preferences

  alt "Email" when "the user prefers email" {
    prefs --> worker : 200 {"channel": "email"}
    worker -> email  : send "Your order is on its way"
    email --> worker : 202
  } alt "Push" when "the user prefers push" {
    prefs --> worker : 200 {"channel": "push"}
    worker -> push   : send "Your order is on its way"
    push  --> worker : 200
  } alt "SMS" when "the user prefers SMS" {
    prefs --> worker : 200 {"channel": "sms"}
    worker -> sms    : send "Your order is on its way"
    sms   --> worker : 202
  } alt "SMS failover" when "the SMS provider times out" {
    prefs     --> worker    : 200 {"channel": "sms"}
    worker     -x sms       : send "Your order is on its way"
    worker     -> smsBackup : send "Your order is on its way"
    smsBackup --> worker    : 202
  } alt "Opted out" when "the user turned these notifications off" {
    prefs --> worker : 200 {"orderShipped": "off"}
  }
}
`,
  hints: [
    'Providers take 200 ms and have outages, but the Order Service needs an answer in under 50 ms. What can accept the event right away and keep it until it is sent?',
    'Put the events on a queue and let workers do the rest; the queue stores them durably and redelivers them when a worker fails.',
    'Ask the Preferences service before calling any provider, so an opted-out user is never contacted.',
    'Model the SMS outage with a failed call (-x sms) followed by a call to smsBackup in the "SMS failover" scenario.',
  ],
};
