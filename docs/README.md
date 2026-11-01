# Architecture diagrams you can play and test

Proschi is a text language for architecture diagrams: you write the services
and the requests between them, and Proschi draws the diagram, plays each
request and checks the design against the traffic you expect.

The example below is a complete design for a link shortener. Hover, tap or
tab to a marked line to see what it does and what it draws.

```proschi annotated
title "Short links"

# @note A node: an id, the name on its box, and a tech stack from the catalog
# @note in square brackets.
user  "Reader"     [Browser]
# @note `x3` runs three replicas of the API. The simulation splits its load
# @note between them.
api   "Links API"  [REST API]   x3
# @note `[Redis]` makes this a cache. The tech stack sets how fast a node
# @note answers and how much load it takes.
cache "Link cache" [Redis]
db    "Links DB"   [PostgreSQL] x2

# @note A connection draws an arrow. Use case steps can only travel along
# @note connections.
user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

# @note A use case is one request, step by step. Press Play to watch it move
# @note through the diagram.
usecase "Open a link" {
  user  -> api   : GET /r/abc
  api   -> cache : GET link:abc
  api   -> db    : SELECT link
  # @note `-->` is the answer going back, with its status code.
  api  --> user  : 302
}

# @note How many requests per second the use case gets. The simulation sends
# @note them through every step.
traffic {
  "Open a link" 2k rps
}

# @note A requirement the design must meet: 99% of requests answered within
# @note 50 ms. The editor checks it as you type.
requirements {
  p99 "Open a link" < 50ms
}
```

> **Try it:** open the example in the editor and change `x3` to `x1` on
> `api`. The p99 requirement fails in **Results**, because one replica cannot
> take 2k rps.

The text is the design. It sits next to your code, you review it in pull
requests, and the layout follows when you add a line. The editor runs in your
browser and keeps your diagrams there. [Why Proschi](WHY.md) says more about
when it fits.

## What to read next

- [Quickstart](QUICKSTART.md): your first diagram in two minutes, played and
  tested.
- [Language overview](LANGUAGE.md): every statement, with a link to the page
  that explains it.
- [Org diagrams](SYSTEMS.md): one box per team, and which team cannot take
  the traffic you send it.
- [How the model works](https://proschi.app/docs/model/): what the simulation
  counts, and how far to trust its numbers.
