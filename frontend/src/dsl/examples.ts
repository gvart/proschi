export const ecommerceExample = `title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway "API Gateway"   [AWS API Gateway] @Platform
  orders  "Order Service" [REST API]        @Orders   "Handles order processing"
  users   "User Service"  [GraphQL]         @Platform
}
ordersDb "Orders DB"   [PostgreSQL] @Orders
usersDb  "Users DB"    [PostgreSQL] @Platform
events   "OrderEvents" [Kafka]      @Platform

gateway -> orders   : HTTP
gateway -> users    : GraphQL
orders  -> users    : GraphQL
orders  -> ordersDb : SQL
users   -> usersDb  : SQL
orders  -> events   : Publish

# One use case, three scenarios: alt branches share the steps before them.
usecase "Create order" "Complete flow for creating a new order" {
  gateway -> orders : POST /api/orders json {
    "userId": "user123",
    "items": [{ "productId": "prod-1", "quantity": 2 }]
  }
  orders -> users : GET /api/users/user123

  alt "Created" {
    users --> orders : 200 {"verified": true}
    par {
      orders  -> ordersDb : INSERT order
      orders ->> events   : OrderCreated {"orderId": "order-789"}
    }
    orders --> gateway : 201 {"orderId": "order-789", "status": "pending"}
  } alt "Unknown user" {
    users  --> orders  : 404
    orders --> gateway : 422 {"error": "unknown_user"}
  } alt "Database down" {
    users  --> orders   : 200 {"verified": true}
    orders  -x ordersDb : INSERT order # -x: the call never gets an answer
    orders --> gateway  : 503 {"error": "try_again_later"}
  }
}

usecase "Get order" {
  gateway -> orders   : GET /api/orders/order-789
  orders  -> ordersDb : SELECT order

  alt "Found" {
    orders --> gateway : 200 {"orderId": "order-789", "status": "pending"}
  } alt "Not found" {
    orders --> gateway : 404 {"error": "not_found"}
  }
}
`;

export const helloExample = `# A Proschi document: nodes, connections and a use case.
title "Hello Proschi"

# id "Display name" [Tech stack] @owner-team
user "User"      [Actor]
api  "Notes API" [REST API]   @backend
db   "Notes DB"  [PostgreSQL] @backend

user -> api : HTTPS
api  -> db  : SQL

# Steps: -> request, --> response, ->> fire-and-forget
usecase "Create a note" {
  user -> api  : POST /notes json {"text": "Buy milk"}
  api  -> db   : INSERT note
  db  --> api  : 1 row
  api --> user : 201 {"id": 42}
}
`;

export const serverlessExample = `title "Serverless Image Pipeline"

group aws "AWS Account" [Network Boundary] {
  gateway  "Upload API"     [AWS API Gateway]
  upload   "Upload Handler" [AWS Lambda]
  bucket   "Images"         [AWS S3]
  jobs     "Resize Jobs"    [AWS SQS]
  resize   "Resizer"        [AWS Lambda]
  metadata "Image Metadata" [AWS DynamoDB]
}
client "Mobile App" [Actor]

client  -> gateway
gateway -> upload
upload  -> bucket   : put original
upload  -> jobs     : enqueue
jobs    -> resize   : trigger
resize  -> bucket   : put thumbnails
resize  -> metadata : save sizes

usecase "Upload a photo" {
  client   -> gateway : POST /images json {"fileName": "cat.jpg"}
  gateway  -> upload  : invoke
  upload   -> bucket  : PUT /originals/cat.jpg
  upload  ->> jobs    : ResizeRequested {"key": "originals/cat.jpg"}
  upload  --> gateway : 202 {"imageId": "img-1"}
  gateway --> client  : 202 {"imageId": "img-1"}
  jobs     -> resize  : ResizeRequested
  par {
    resize -> bucket   : PUT /thumbs/cat-200.jpg
    resize -> metadata : PutItem {"imageId": "img-1", "sizes": [200, 800]}
  }
}
`;

export const loginExample = `title "Login with Sessions"

browser  "Browser"       [Actor]
web      "Web App"       [REST API]     @web
auth     "Auth Service"  [Auth Service] @identity
users    "Users DB"      [PostgreSQL]   @identity
sessions "Session Store" [Redis]        @identity
note     "Sessions"      [Sticky Note]  "Sessions expire after 30 minutes of inactivity"

browser -> web
web     -> auth
auth    -> users
auth    -> sessions

usecase "Log in" "Password login that creates a session" {
  browser -> web   : POST /login json {"email": "ada@example.com", "password": "***"}
  web     -> auth  : POST /v1/authenticate
  auth    -> users : SELECT user by email
  users  --> auth  : 1 row

  alt "Success" {
    auth  -> sessions : SET session:abc123 EX 1800
    auth --> web      : 200 {"sessionId": "abc123"}
    web  --> browser  : 302 text Set-Cookie: sid=abc123
  } alt "Wrong password" {
    auth --> web     : 401 {"error": "invalid_credentials"}
    web  --> browser : 401
  } alt "Session store down" {
    auth  -x sessions : SET session:abc123 EX 1800
    auth --> web      : 503
    web  --> browser  : 503 text Please try again
  }
}

usecase "Log out" {
  browser -> web      : POST /logout
  web     -> auth     : DELETE /v1/sessions/abc123
  auth    -> sessions : DEL session:abc123
  auth   --> web      : 204
  web    --> browser  : 302 text Set-Cookie: sid=; Max-Age=0
}
`;

export const eventDrivenExample = `title "Event-Driven Checkout"

checkout  "Checkout Service"  [REST API]        @payments
payments  "Payment Provider"  [Payment Gateway]
bus       "Order Events"      [Kafka]           @platform
inventory "Inventory Service" [REST API]        @warehouse
email     "Notifier"          [Email Service]   @growth
ledger    "Ledger DB"         [PostgreSQL]      @payments

checkout -> payments  : charge
checkout -> bus       : publish
bus      -> inventory : consume
bus      -> email     : consume
checkout -> ledger

usecase "Pay for an order" {
  checkout  -> payments : POST /charges json {"amount": 4999, "currency": "EUR"}
  payments --> checkout : 201 {"chargeId": "ch_1"}
  checkout  -> ledger   : INSERT payment
  checkout ->> bus      : OrderPaid {"orderId": "o-7"}
  par {
    bus -> inventory : OrderPaid
    bus -> email     : OrderPaid
  }
}
`;

export const urlShortenerExample = `title "URL Shortener" "Turns long URLs into short codes and redirects visitors to them"

visitor "Visitor"       [Actor]
lb      "Load Balancer" [AWS Load Balancer] @platform x3
api     "Shortener API" [REST API]          @links    x12 "Creates codes and serves redirects"
cache   "Code cache"    [Redis]             @links    x2 "Recently used codes"
db      "URL store"     [PostgreSQL]        @links    x3 "Every code and its target"

visitor -> lb
lb      -> api
api     -> cache : code lookups
api     -> db    : SQL

usecase "Redirect" "A visitor opens a short link" {
  visitor -> lb  : GET /abc123
  lb      -> api : GET /abc123
  alt "Cache hit" when "the code was used recently" {
    api    -> cache   : GET code:abc123
    cache --> api     : target example.com/a/very/long/path
    api   --> lb      : 301
    lb    --> visitor : 301
  } alt "Cache miss" when "the code is not cached" {
    api    -> cache   : GET code:abc123
    cache --> api     : nil
    api    -> db      : SELECT target FROM urls WHERE code = 'abc123'
    db    --> api     : 1 row
    api   ->> cache   : SET code:abc123
    api   --> lb      : 301
    lb    --> visitor : 301
  } alt "Unknown code" when "no URL has that code" {
    api    -> cache   : GET code:abc123
    cache --> api     : nil
    api    -> db      : SELECT target FROM urls WHERE code = 'abc123'
    db    --> api     : 0 rows
    api   --> lb      : 404
    lb    --> visitor : 404
  } alt "Cache down" when "Redis does not answer" {
    api  -x cache   : GET code:abc123
    api  -> db      : SELECT target FROM urls WHERE code = 'abc123'
    db  --> api     : 1 row
    api --> lb      : 301
    lb  --> visitor : 301
  }
}

usecase "Shorten" "Creates a short code for a long URL" {
  visitor -> lb  : POST /links json {"target": "example.com/a/very/long/path"}
  lb      -> api : POST /links json {"target": "example.com/a/very/long/path"}
  alt "Created" {
    api  -> db      : INSERT url
    db  --> api     : code abc123
    api --> lb      : 201 {"code": "abc123"}
    lb  --> visitor : 201 {"code": "abc123"}
  } alt "Invalid URL" when "the target is not a valid URL" {
    api --> lb      : 400 {"error": "invalid_url"}
    lb  --> visitor : 400 {"error": "invalid_url"}
  }
}

# How much traffic each use case gets, and how it splits over the scenarios.
traffic {
  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 9%, "Unknown code" 1%
  "Shorten"  1k rps
}

requirements {
  p99 "Redirect" < 100ms
  p95 < 300ms # every use case
  availability "Redirect" >= 99.95%
  availability >= 99.9%
  durable "Shorten"
  survive any node failure
  survive failure of any cache
  cost <= 5000 usd/month
}

# Per-replica overrides of the default profiles.
capacity {
  # Redirects are a cache lookup: a light, fast service.
  api   20k rps latency 4ms
  cache 150k rps
  db    8k rps latency 4ms availability 99.95% cost 450 usd/month durable
}

entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
  expiresAt time   optional
}

decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1 and p99 must stay under 100 ms"
  rejected "Read replicas only" "About 5 ms per read and many replicas at 100k rps"
  rejected "Memcached" "No replication; losing a node empties the cache"
}
decision "Base62 codes from a counter" because "Short, unique, and no collisions to retry"

test "Redirects are served from the cache" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
  "Redirect" scenario "Cache miss" calls db
  "Redirect" every scenario calls api
  "Redirect" handles failure of cache
  "Redirect" responds 4xx
}
test "Short codes are durable" {
  "Shorten" writes db before responding
  "Shorten" scenario "Created" responds 201
  "Shorten" has scenario "Invalid URL"
}
test "Visitors only enter through the load balancer" {
  no path from visitor to any database
  [REST API] has replicas >= 2
  db has replicas >= 2
}
`;

export interface Example {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const examples: Example[] = [
  { id: 'hello', name: 'Hello Proschi', description: 'The basics: nodes, connections and one use case.', source: helloExample },
  { id: 'ecommerce', name: 'E-commerce platform', description: 'Success and error scenarios per endpoint, multi-line payloads and parallel steps.', source: ecommerceExample },
  { id: 'serverless', name: 'Serverless pipeline', description: 'API Gateway, Lambda, S3 and SQS with async processing.', source: serverlessExample },
  { id: 'login', name: 'Login with sessions', description: 'Log in with success, wrong-password and outage scenarios, plus log out.', source: loginExample },
  { id: 'events', name: 'Event-driven checkout', description: 'Kafka fan-out to several consumers.', source: eventDrivenExample },
  { id: 'url-shortener', name: 'URL shortener HLD', description: 'A high-level design: traffic, requirements, capacity, data model, decisions and flow tests.', source: urlShortenerExample },
];
