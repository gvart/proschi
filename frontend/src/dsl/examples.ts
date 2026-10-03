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
];
