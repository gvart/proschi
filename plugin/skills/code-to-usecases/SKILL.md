---
name: code-to-usecases
description: Read application code and write Proschi `usecase` blocks (request flows with responses, async messages, parallel calls and alt failure scenarios) that pass `proschi check` and `proschi test`. Use when the user wants sequence diagrams, request flows or use cases of their endpoints, consumers or jobs in Proschi; when a .proschi architecture exists but has no use cases; or when they point at HTTP routes, controllers, gRPC services, message handlers or an OpenAPI spec and ask how a request flows through the system. Works for any language (Spring/Kotlin, Express/NestJS, FastAPI/Django, Go, Rails and others).
license: MIT
---

# Application code → Proschi use cases

Goal: one `usecase` per important entry point (endpoint, RPC, consumer,
scheduled job), each tracing the calls the code really makes, with an `alt`
branch per outcome the code handles, passing `npx proschi@latest check` and
`test`, and a share link for the user.

Syntax, arrows and the CLI: [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md).

## 1. Start from the architecture

Use cases play over nodes and connections. If the repo has a `.proschi` file
with the architecture, put the use cases in it or in a new file that starts
with `import "architecture.proschi"`. If there is none, write the nodes
first (the `infra-to-proschi` skill; minimum: a client, each service, each
store, each external API) and connect them.

**OpenAPI shortcut.** With a spec, scaffold one use case per operation, then
replace `api` with the real node id and fill in the downstream calls:

```sh
npx proschi@latest import openapi openapi.yaml -o api-usecases.proschi
```

## 2. Find the entry points

| Stack | Entry points | Outbound calls to look for |
|---|---|---|
| Spring / Kotlin | `@RestController` + `@GetMapping`/`@PostMapping`, `@KafkaListener`, `@RabbitListener`, `@SqsListener`, `@Scheduled`, gRPC `*ImplBase` | `JpaRepository`/`JdbcTemplate`, `RedisTemplate`/`@Cacheable`, `KafkaTemplate.send`, `RestTemplate`/`WebClient`/`@FeignClient` |
| Express / NestJS | `app.get/post`, `router.*`, `@Controller` + `@Get()/@Post()`, `@MessagePattern`, `@EventPattern`, `@Cron` | `pg`/`knex`/Prisma/TypeORM, `ioredis`, `kafkajs`/`amqplib`/SQS `send`, `fetch`/`axios`, SDKs (`stripe`, `@sendgrid/mail`) |
| FastAPI / Django | `@app.get`/`@router.post`, Django `urls.py` → views/DRF viewsets, Celery `@shared_task`, management commands | SQLAlchemy/ORM `.objects`, `redis`, `.delay()`/`apply_async`, `boto3`, `httpx`/`requests` |
| Go | `http.HandleFunc`, `mux.HandleFunc`, gin/echo/chi routes, gRPC `Register*Server`, consumer loops | `database/sql`/`sqlx`/gorm, `go-redis`, `sarama`/`franz-go`, `http.Client`, generated gRPC clients |
| Rails | `config/routes.rb` → controller actions, ActiveJob/Sidekiq `perform`, `ActionCable` channels | ActiveRecord, `Rails.cache`, `perform_later`, `Net::HTTP`/Faraday |
| Anything else | route tables, `main` loops, queue subscriptions, cron | DB drivers, cache clients, producers, HTTP/gRPC clients |

Prioritise: the endpoints a user hits most, anything that writes or takes
money, and every consumer. Skip health checks, metrics and admin CRUD unless
asked. Keep it to 3–10 use cases; a use case may have up to 32 scenarios.

## 3. Translate one handler

Walk the handler top to bottom, following calls into services and
repositories, and write one step per network call:

| Code | Step |
|---|---|
| The incoming request | `client -> svc : POST /orders {"sku": "A1"}` (path params as `{id}`; a small realistic JSON body) |
| SQL / ORM read, write | `svc -> db : SELECT order`, `svc -> db : INSERT order` (start with the verb: it decides read vs write) |
| Cache get / set | `svc -> cache : LOOKUP product:{id}` / `svc -> cache : SET product:{id}`. Don't start a non-HTTP label with an HTTP verb: `GET key` is read as an HTTP GET to path `key` |
| Synchronous HTTP / gRPC to another service | `svc -> other : GET /users/{id}` then `other --> svc : 200 {…}` |
| Publish / enqueue / `.delay()` / `send` (not awaited for a result) | `svc ->> queue : OrderPlaced {"orderId": "o-1"}` |
| The consumer of that message | after the entry response: `queue ->> worker : OrderPlaced`, then the worker's own steps |
| `Promise.all`, `CompletableFuture.allOf`, `asyncio.gather`, goroutines + `WaitGroup` | `par { … }` around those steps |
| Loop of N calls | `x<N>` prefix: `svc -> db : x20 SELECT item` |
| Upload / download of a big payload | `~<size>` prefix: `client -> blobs : ~5MB PUT /files/{id}` |
| `return res.status(201).json(…)` | `svc --> client : 201 {…}` |
| `if (!valid) return 400`, `catch (e) { return 502 }`, not found, timeouts | one `alt` branch each, with `when "…"` naming the condition |
| A call that times out / is refused, with a fallback | `svc -x dep : …` inside a branch, then what the code does next |

Responses are optional for internal hops (add them when the body matters),
but **the entry request must be answered in every branch with a status**:
a scenario is an error path only when that first request gets a 4xx/5xx or
a `-x`. If the request passes through a proxy or gateway, answer each hop
inside each branch (`api --> gw : 404`, `gw --> user : 404`).

Mark anything you inferred rather than read with a comment:
`# GUESS: retries handled by the SDK`.

## 4. Assert what the code guarantees

Add a `test` block for behaviour that should not regress, e.g.:

```proschi fragment
test "Checkout stays fast" {
  "Place order" never waits for any external or any queue
  "Place order" writes db before responding
  "Place order" has scenario "Payment failed"
  "Get product" calls cache before db
}
```

## 5. Validate and iterate

```sh
npx proschi@latest fmt usecases.proschi
npx proschi@latest check usecases.proschi
npx proschi@latest test usecases.proschi
```

Fix until clean. Common fixes: `No connection between 'a' and 'b'` → add
`a -> b` to the architecture (or you used the wrong node); `Response has no
matching request from 'b' to 'a'` → the `-->` goes back the way the request
came (`b --> a` answers `a -> b`); a test that fails because the code really does
wait on something → tell the user, don't weaken the test silently. If the
spec is available, `npx proschi@latest check --openapi svc=openapi.yaml usecases.proschi`
also checks paths, status codes and bodies against it.

## 6. Hand over

```sh
npx proschi@latest share-link usecases.proschi
```

Give the user the file, the link (it opens the diagram with playback of
every scenario; the content travels in the link), which handlers each use
case came from, and the guesses to confirm.

## Worked example

`src/app.js` (Express):

```js
app.post('/orders', async (req, res) => {
  if (!req.body.productId) return res.status(400).json({ error: 'productId required' });
  try { charge = await stripe.paymentIntents.create({ /* … */ }); }
  catch (e) { return res.status(402).json({ error: 'payment_failed' }); }
  const { rows } = await db.query('INSERT INTO orders … RETURNING id', [/* … */]);
  channel.sendToQueue('order-created', Buffer.from(JSON.stringify({ orderId: rows[0].id })));
  res.status(201).json({ id: rows[0].id, status: 'paid' });
});
// src/worker.js: consume('order-created') → SELECT email, sendgrid.send, UPDATE orders
```

```proschi
title "Shop"

user     "Customer"     [Browser]
api      "Shop API"     [Node.js]
db       "Shop DB"      [PostgreSQL]
rabbit   "Order events" [RabbitMQ]
worker   "Order worker" [Node.js]
stripe   "Stripe"       [Stripe]
sendgrid "SendGrid"     [SendGrid]

user   -> api      : HTTPS
api    -> db       : SQL
api    -> stripe   : HTTPS
api    -> rabbit   : Publish
rabbit -> worker   : Consume
worker -> db       : SQL
worker -> sendgrid : HTTPS

# src/app.js: app.post('/orders'); src/worker.js: consume('order-created')
usecase "Place order" {
  user -> api : POST /orders {"productId": "p-1", "quantity": 2}
  alt "Paid" {
    api     -> stripe   : CHARGE payment intent
    stripe --> api      : succeeded
    api     -> db       : INSERT order
    api    ->> rabbit   : order-created {"orderId": "o-1"}
    api    --> user     : 201 {"id": "o-1", "status": "paid"}
    rabbit ->> worker   : order-created {"orderId": "o-1"}
    worker  -> db       : SELECT order and user email
    worker  -> sendgrid : SEND confirmation email
    worker  -> db       : UPDATE orders SET confirmation_sent
  } alt "Invalid" when "productId missing" {
    api --> user : 400 {"error": "productId required"}
  } alt "Payment failed" when "Stripe declines or errors" {
    api     -> stripe : CHARGE payment intent
    stripe --> api    : card_declined
    api    --> user   : 402 {"error": "payment_failed"}
  }
}

test "Checkout does not wait for the email" {
  "Place order" never waits for sendgrid
  "Place order" writes db before responding
}
```
