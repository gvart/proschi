import type { Problem } from '../types';

export const payments: Problem = {
  id: 'payments',
  title: 'Payments with Idempotency',
  difficulty: 'hard',
  tags: ['idempotency', 'consistency', 'queues', 'external-api', 'durability'],
  statement: `An online shop charges cards through an external payment gateway. The
gateway is slow (about **250 ms** per charge) and now and then times out. Mobile
clients on bad networks retry when they do not hear back in time, so the same
checkout often arrives twice. A shopper must **never be charged twice** for one
checkout, and a charge that went through must never be lost.

Every checkout carries an \`Idempotency-Key\` chosen by the client; a retry
sends the same key again.

## Functional requirements

- **Checkout**: the shopper sends \`POST /payments\` with the order, the amount
  and the idempotency key. Model it with three scenarios:
  - \`"Charged"\`: the key is new and the gateway approves; the money is
    recorded in the ledger and the shopper gets \`201\`.
  - \`"Replay"\`: the key was seen before (a retry); the shopper gets the
    stored result of the first attempt with a \`2xx\`, and nothing is charged
    or booked again.
  - \`"Gateway down"\`: the gateway call fails or times out. The shopper gets
    \`202\` with the payment *pending*; the charge is retried later in the
    background with the same key, and the ledger is written once it succeeds.
- **Retry charge**: a pending payment is handed from the retry queue to a
  worker, which charges it again with the same idempotency key, books the
  money in the ledger and marks the payment succeeded before acknowledging
  the message.

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- **1k checkouts per second** at peak (a sales event).
- About **5%** of them are retries of an earlier checkout.
- About **0.5%** of gateway calls fail or time out, so about **5 retries
  per second**.

## Constraints

- The gateway is only called for a payment that is already recorded, so a
  crash at any point leaves a trace to reconcile or retry.
- Money is booked in the ledger only after the gateway approved the charge.
- p99 of a checkout under **1.5 s**, the gateway included.
- Checkout available **99.95%** of the time, more than the gateway itself
  offers (99.9%).
- A successful checkout is stored durably before the shopper hears back.
- Losing any single machine must not take checkout down.
- At most **$3,000 / month**, the ledger included.

## What is given

\`problem.proschi\` declares the \`shopper\`, the external \`gateway\` (a card
processor: 250 ms per call, up to 5k calls per second) and the \`ledger\`, the
finance team's double-entry ledger (PostgreSQL, two replicas) where only
approved money is booked. Add the payments service, where payments and their
idempotency keys live, how failed charges are retried, the connections and the
use case.`,
  given: `title "Payments" "Charges a card exactly once per checkout, even when clients retry and the gateway fails"

shopper "Shopper"         [Actor]
gateway "Payment Gateway" [Payment Gateway]      "External card processor; slow, and sometimes times out"
ledger  "Ledger"          [PostgreSQL]      x2 @finance "Double-entry ledger; only approved money is booked here"

capacity {
  gateway 5k rps latency 250ms
}

traffic {
  "Checkout"     1k rps mix "Charged" 94.5%, "Replay" 5%, "Gateway down" 0.5%
  "Retry charge" 5 rps
}

requirements {
  p99 "Checkout" < 1500ms
  availability "Checkout" >= 99.95%
  durable "Checkout"
  survive any node failure
  cost <= 3000 usd/month
}

test "The payment is recorded before the card is charged" {
  "Checkout" calls any database before gateway
}

test "A retry returns the stored result and charges nothing" {
  "Checkout" has scenario "Replay"
  "Checkout" scenario "Replay" calls any database
  "Checkout" scenario "Replay" never calls gateway
  "Checkout" scenario "Replay" never calls ledger
  "Checkout" scenario "Replay" responds 2xx
}

test "Money is booked only after the gateway approves" {
  "Checkout" scenario "Charged" calls gateway before ledger
  "Checkout" scenario "Charged" writes ledger before responding
  "Checkout" scenario "Charged" responds 201
}

test "A failing gateway leaves the payment pending, not lost" {
  "Checkout" handles failure of gateway
  "Checkout" scenario "Gateway down" responds 202
  "Checkout" scenario "Gateway down" calls any queue
  "Checkout" scenario "Gateway down" never calls ledger
}

test "Pending charges are retried in the background with the same key" {
  "Retry charge" calls any database before gateway
  "Retry charge" calls gateway before ledger
  "Retry charge" writes ledger before responding
}
`,
  starter: `import "problem.proschi"

# Add where payments and their idempotency keys live, how failed charges are
# retried, and the scenarios "Charged", "Replay" and "Gateway down".
api "Payments API" [REST API]

shopper -> api
api     -> gateway
api     -> ledger

usecase "Checkout" {
  shopper  -> api     : POST /payments json {"orderId": "o-1042", "amount": 4999, "idempotencyKey": "chk_7f3a"}
  api      -> gateway : POST /charges
  gateway --> api     : 201 approved
  api      -> ledger  : INSERT entries
  api     --> shopper : 201 {"status": "succeeded"}
}
`,
  solution: `import "problem.proschi"

lb      "Load Balancer"   [AWS Load Balancer] x2 @platform
api     "Payments API"    [REST API]          x3 @payments "Records payments, calls the gateway, answers retries"
intents "Payment Intents" [PostgreSQL]        x2 @payments "One row per idempotency key: status and the stored response"
retries "Retry Queue"     [AWS SQS]           x2 @payments "Pending charges to retry with the same key"
worker  "Retry Worker"    [AWS ECS]           x2 @payments "Retries pending charges and books them"

shopper -> lb
lb      -> api     : HTTPS
api     -> intents : SQL
api     -> gateway : charge
api     -> ledger  : book
api     -> retries : enqueue
retries -> worker  : deliver
worker  -> gateway : charge
worker  -> ledger  : book
worker  -> intents : SQL

entity PaymentIntent in intents "One checkout attempt, keyed by the client's idempotency key" {
  idempotencyKey string key
  orderId        string index
  amount         int
  currency       string
  status         string
  response       json   optional
  createdAt      time
}

entity LedgerEntry in ledger "One side of a double-entry booking" {
  id        uuid   key
  paymentId string index
  account   string
  amount    int
  createdAt time
}

decision "Record the intent before calling the gateway" {
  because "A crash between the charge and the write would otherwise leave money taken with no trace; with the row first, every charge has a record to reconcile or retry"
  rejected "Charge first, then write" "A timeout after the gateway approved loses the payment, and the client's retry charges again"
}
decision "Idempotency keys under a unique constraint in PostgreSQL" {
  because "INSERT … ON CONFLICT is atomic and durable: two concurrent retries cannot both win, and the key survives a failover"
  rejected "Redis SETNX" "Not durable: a failover forgets keys, and the next retry charges again"
  rejected "Check, then insert" "Two retries arriving together both see no row and both charge"
}
decision "Pass the same idempotency key to the gateway" because "If our call timed out after the gateway charged, the background retry returns the first charge instead of a second one"
decision "Answer 202 and retry from a queue when the gateway fails" {
  because "The charge may or may not have happened; the payment stays pending and a worker retries it, so checkout stays up when the gateway does not"
  rejected "Return 502 and let the client retry" "The shopper sees an error for a payment that may have gone through, and checkout is only as available as the gateway"
}

usecase "Checkout" "Charge the shopper's card for an order, exactly once" {
  shopper -> lb      : POST /payments json {"orderId": "o-1042", "amount": 4999, "currency": "EUR", "idempotencyKey": "chk_7f3a"}
  lb      -> api     : POST /payments
  api     -> intents : INSERT intent ON CONFLICT (idempotencyKey) DO NOTHING

  alt "Charged" when "the key is new and the gateway approves" {
    intents --> api     : inserted, status pending
    api      -> gateway : POST /charges Idempotency-Key chk_7f3a
    gateway --> api     : 201 approved
    api      -> ledger  : INSERT debit and credit entries
    ledger  --> api     : ok
    api      -> intents : UPDATE status succeeded, store response
    intents --> api     : ok
    api     --> lb      : 201 {"paymentId": "pay_81", "status": "succeeded"}
    lb      --> shopper : 201 {"paymentId": "pay_81", "status": "succeeded"}
  } alt "Replay" when "the key was seen before" {
    intents --> api     : conflict, stored response
    api     --> lb      : 201 {"paymentId": "pay_81", "status": "succeeded"}
    lb      --> shopper : 201 {"paymentId": "pay_81", "status": "succeeded"}
  } alt "Gateway down" when "the gateway times out or fails" {
    intents --> api     : inserted, status pending
    api      -x gateway : POST /charges Idempotency-Key chk_7f3a
    api     ->> retries : RetryCharge {"idempotencyKey": "chk_7f3a"}
    api     --> lb      : 202 {"paymentId": "pay_81", "status": "pending"}
    lb      --> shopper : 202 {"paymentId": "pay_81", "status": "pending"}
  }
}

usecase "Retry charge" "The queue hands a worker one pending charge; it is acknowledged once booked" {
  retries  -> worker  : RetryCharge {"idempotencyKey": "chk_7f3a"}
  worker   -> intents : SELECT intent FOR UPDATE
  intents --> worker  : status pending
  worker   -> gateway : POST /charges Idempotency-Key chk_7f3a
  gateway --> worker  : 201 approved
  worker   -> ledger  : INSERT debit and credit entries
  ledger  --> worker  : ok
  worker   -> intents : UPDATE status succeeded, store response
  intents --> worker  : ok
  worker  --> retries : ack
}
`,
  hints: [
    'What happens if the service crashes right after the gateway approved the charge? Write something durable before you call the gateway, so every charge has a record.',
    'Make the idempotency key the primary key of a payments table: an INSERT that conflicts tells you this is a retry, and the stored row holds the answer to give back. A cache is not enough: it can forget keys.',
    'When the gateway call fails you do not know whether the card was charged. Answer 202 pending and put the payment on a queue. In "Retry charge" the queue hands it to a worker, which charges again with the same key (the gateway deduplicates too), books it and only then acknowledges the message.',
    'The fallback scenario also lifts availability above the gateway\'s own 99.9%. Size the rest for 1k rps with two replicas of everything.',
  ],
};
