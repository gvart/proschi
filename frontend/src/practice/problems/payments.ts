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
    booked in the ledger, the payment is marked succeeded with its response
    stored, and the shopper gets \`201\`.
  - \`"Replay"\`: the key was seen before (a retry); the shopper gets the
    stored result of the first attempt with a \`2xx\`, and nothing is charged
    or booked again.
  - \`"Gateway down"\`: the gateway call fails or times out. The shopper gets
    \`202\` with the payment *pending*; the charge is retried later in the
    background with the same key, and the ledger is written once it succeeds.
- **Retry charge**: the retry queue hands a pending payment to a worker,
  which charges it again with the same idempotency key, books the money in the
  ledger and marks the payment succeeded before acknowledging the message.

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- **1k checkouts per second** at peak (a sales event).
- About **5%** of them are retries of an earlier checkout.
- About **0.5%** of gateway calls fail or time out, so about **5 retries
  per second**.

## Constraints

- Before the gateway is called, the payment is **inserted** (a real write, not
  a lookup) into a **strongly consistent**, durable store, keyed by the
  idempotency key. A cache that can lag or forget keys is never consulted:
  it would let a retry charge twice. A crash at any point then leaves a
  trace to reconcile or retry.
- Money is booked in the ledger only after the gateway approved the charge,
  and the payment is marked succeeded (with the response a retry gets back)
  only after the money is booked.
- p99 of a checkout under **1.5 s**, the gateway included; a replay is
  answered from the stored result in under **100 ms** at p99.
- Checkout available **99.95%** of the time, more than the gateway itself
  offers (99.9%).
- Every successful checkout, replays included, writes durably before the
  shopper hears back.
- Retries are driven by a queue, never by the shopper's request.
- Losing any single machine must not take checkout down.
- At most **$2,500 / month**, the finance ledger's three replicas included.

## What is given

\`problem.proschi\` declares the \`shopper\`, the external \`gateway\` (a card
processor: 250 ms per call, up to 5k calls per second) and the \`ledger\`, the
finance team's double-entry ledger API (three replicas) where only approved
money is booked: book with a write such as \`APPEND entries\`. Add the
payments service, where payments and their idempotency keys live, how failed
charges are retried, the connections and the use cases.

A relational database takes about **5k writes per second** on its primary,
whatever its number of replicas; replicas add only reads.`,
  given: `title "Payments" "Charges a card exactly once per checkout, even when clients retry and the gateway fails"

shopper "Shopper"         [Actor]
gateway "Payment Gateway" [Payment Gateway] "External card processor; slow, and sometimes times out"
ledger  "Ledger API"      [gRPC]            x3 @finance "Double-entry ledger; only approved money is booked here"

capacity {
  gateway 5k rps latency 250ms
}

traffic {
  "Checkout"     1k rps mix "Charged" 94.5%, "Replay" 5%, "Gateway down" 0.5%
  "Retry charge" 5 rps
}

requirements {
  p99 "Checkout" < 1500ms
  p99 "Checkout" scenario "Replay" < 100ms
  availability "Checkout" >= 99.95%
  durable "Checkout"
  survive any node failure
  cost <= 2500 usd/month
}

test "The payment is recorded in a strong store before the card is charged" {
  "Checkout" calls any strong store before gateway
  "Checkout" never calls any eventual store
}

test "A retry returns the stored result and charges nothing" {
  "Checkout" has scenario "Replay"
  "Checkout" scenario "Replay" calls any strong store
  "Checkout" scenario "Replay" never calls gateway or ledger
  "Checkout" scenario "Replay" responds 2xx
}

test "Money is booked only after the gateway approves" {
  "Checkout" calls gateway before ledger
  "Checkout" scenario "Charged" writes ledger before responding
  "Checkout" scenario "Charged" responds 201
}

test "The payment is marked succeeded only once the money is booked" {
  "Checkout" scenario "Charged" calls any strong store after ledger
  "Retry charge" calls any strong store after ledger
}

test "A failing gateway leaves the payment pending, not lost" {
  "Checkout" handles failure of gateway
  "Checkout" scenario "Gateway down" responds 202
  "Checkout" scenario "Gateway down" calls any queue
  "Checkout" scenario "Gateway down" never waits for ledger
}

test "Pending charges are retried from a queue with the same key" {
  "Retry charge" starts at any queue
  "Retry charge" calls any strong store before gateway
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
  api      -> ledger  : APPEND entries
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

decision "Insert the intent before calling the gateway" {
  because "A crash between the charge and the write would otherwise leave money taken with no trace; with the row first, every charge has a record to reconcile or retry"
  rejected "Charge first, then write" "A timeout after the gateway approved loses the payment, and the client's retry charges again"
}
decision "Idempotency keys under a unique constraint in PostgreSQL" {
  because "INSERT … ON CONFLICT is atomic, strongly consistent and durable: two concurrent retries cannot both win, the key survives a failover, and every attempt (a replay too) is a real write"
  rejected "Redis SETNX" "Eventually consistent and not durable: a failover forgets keys, and the next retry charges again"
  rejected "SELECT the key, then INSERT" "Two retries arriving together both see no row and both charge; and a replay that only reads stores nothing"
}
decision "Mark the payment succeeded after booking the ledger" {
  because "A crash between the charge and the booking leaves the payment pending, so a retry books it; the ledger dedupes on the payment id. Marking it first would hide a charge that was never booked"
  rejected "Write status and ledger entries before charging" "Books money the gateway may decline"
}
decision "Pass the same idempotency key to the gateway" because "If our call timed out after the gateway charged, the background retry returns the first charge instead of a second one"
decision "Answer 202 and retry from a queue when the gateway fails" {
  because "The charge may or may not have happened; the payment stays pending and a worker retries it, so checkout stays up when the gateway does not"
  rejected "Retry the gateway inline before answering" "The shopper waits for a second timeout, and checkout is only as available as the gateway"
  rejected "Return 502 and let the client retry" "The shopper sees an error for a payment that may have gone through"
}
decision "One PostgreSQL primary is enough" because "Checkout writes about 2k rows a second (insert, then update) against 5k a primary takes; the replica is for failover"

usecase "Checkout" "Charge the shopper's card for an order, exactly once" {
  shopper -> lb      : POST /payments json {"orderId": "o-1042", "amount": 4999, "currency": "EUR", "idempotencyKey": "chk_7f3a"}
  lb      -> api     : POST /payments
  api     -> intents : INSERT intent ON CONFLICT (idempotencyKey) DO NOTHING RETURNING *

  alt "Charged" when "the key is new and the gateway approves" {
    intents --> api     : inserted, status pending
    api      -> gateway : POST /charges Idempotency-Key chk_7f3a
    gateway --> api     : 201 approved
    api      -> ledger  : APPEND debit and credit entries for pay_81
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
    api      -> retries : ENQUEUE RetryCharge {"idempotencyKey": "chk_7f3a"}
    retries --> api     : ok
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
  worker   -> ledger  : APPEND debit and credit entries for pay_81
  ledger  --> worker  : ok
  worker   -> intents : UPDATE status succeeded, store response
  intents --> worker  : ok
  worker  --> retries : ack
}
`,
  hints: [
    'What happens if the service crashes right after the gateway approved the charge? INSERT something durable before you call the gateway, so every charge has a record.',
    'Make the idempotency key the primary key of a payments table in a strongly consistent store: an INSERT that conflicts tells you this is a retry, and the stored row holds the answer to give back. Do not SELECT first (two retries race), and keep caches out of it: they can lag or forget keys.',
    'Order matters in "Charged": gateway, then the ledger, then UPDATE the payment to succeeded with its stored response. A replay then reads a result that is only there once the money is booked.',
    'When the gateway call fails you do not know whether the card was charged. Answer 202 pending and put the payment on a queue. "Retry charge" starts at that queue: it hands the payment to a worker, which charges again with the same key (the gateway deduplicates too), books it, marks it succeeded and only then acknowledges the message.',
    'The fallback scenario also lifts availability above the gateway\'s own 99.9%. Size the rest for 1k rps with two replicas of everything; one PostgreSQL primary takes the ~2k writes a second.',
  ],
};
