export const ecommerceExample = `title "E-Commerce Platform"

group vpc "AWS VPC" {
  gateway  "API Gateway"   [AWS API Gateway] @Platform
  orders   "Order Service" [REST API]        @Orders  "Handles order processing"
  users    "User Service"  [GraphQL]         @Platform
}
ordersDb "Orders DB"   [PostgreSQL] @Orders
usersDb  "Users DB"    [PostgreSQL] @Platform
events   "OrderEvents" [Kafka]      @Platform

gateway -> orders   : HTTP
gateway -> users    : GraphQL
orders  -> ordersDb : SQL
users   -> usersDb  : SQL
orders  -> events   : Publish

usecase "Create order" "Complete flow for creating a new order" {
  gateway -> orders : POST /api/orders json {
    "userId": "user123",
    "items": [{ "productId": "prod-1", "quantity": 2 }]
  }
  orders -> users  : GET /api/users/user123
  users --> orders : 200 {"verified": true}
  par {
    orders -> ordersDb : INSERT order
    orders ->> events  : OrderCreated {"orderId": "order-789"}
  }
  orders --> gateway : 201 {"orderId": "order-789", "status": "pending"}
}
`;
