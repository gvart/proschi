/** A new diagram that teaches as you read it: a tiny working system with the syntax in comments. */
export const STARTER_TEMPLATE = `title "My system"

# A Proschi document is plain text: nodes, connections and use cases.
# Help (?) > Syntax cheat-sheet has the rest. Delete these comments any time.

# Nodes: id "Name" [Tech] @team x<replicas>
user "User"     [Actor]
api  "API"      [REST API]
db   "Database" [PostgreSQL]

# Connections: from -> to : label
user -> api : HTTPS
api  -> db  : SQL

# Use cases play step by step (press Play):
# -> request, --> response, ->> fire and forget, -x failed call
usecase "Sign up" {
  user -> api  : POST /users json {"email": "ada@example.com"}
  api  -> db   : INSERT user
  api --> user : 201 {"id": 1}
}

# Next: alt "…" { } scenarios, then traffic { }, requirements { } and
# test "…" { } blocks bring the Analysis and Tests tabs to life.
`;
