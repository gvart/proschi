/** A small editor design that parses, simulates and passes its one requirement. */
export const SHOP = `title "Shop"

user "Shopper"  [Browser]
api  "Shop API" [REST API] x2
db   "Orders"   [PostgreSQL]

user -> api : HTTPS
api  -> db  : SQL

usecase "Order" {
  user -> api : POST /orders
  api  -> db  : INSERT order
  api --> user : 201
}

traffic {
  "Order" 200 rps
}

requirements {
  p99 "Order" < 500ms
}
`;
