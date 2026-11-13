---
updated: 2026-11-12
---

# Proschi vs Mermaid, PlantUML, Structurizr and D2

Mermaid, PlantUML, Structurizr, D2 and Proschi all turn text into
diagrams. Proschi is the one that also runs the design: it plays each
request and simulates load, p99, availability and cost from the traffic you
write beside it.

```proschi
title "Shortener"

user  "Visitor"   [Browser]
api   "Redirects" [REST API]   x4
cache "Hot links" [Redis]
db    "Links"     [PostgreSQL]

user -> api   : HTTPS
api  -> cache : RESP
api  -> db    : SQL

usecase "Redirect" {
  user -> api : GET /{code}
  alt "Hit" {
    api -> cache : GET link
    api --> user : 301
  } alt "Miss" {
    api -> cache : GET link
    api -> db    : SELECT link
    api --> user : 301
  }
}

traffic {
  "Redirect" 5k rps mix "Hit" 90%, "Miss" 10%
}

requirements {
  p99 "Redirect" < 50ms
  survive any node failure
}
```

> **Try it:** change the mix to `"Hit" 50%, "Miss" 50%` and watch
> `Links` take five times the load.

The first half of that file draws a diagram any of these tools could
draw. The `traffic` and `requirements` blocks are what the others have no
equivalent for. In the *Results* tab the p99 requirement passes at 43 ms,
and `survive any node failure` fails: losing one `api` replica pushes p99
past 50 ms, and `cache` and `db` have no second replica.

## At a glance

| | Proschi | Mermaid | PlantUML | Structurizr | D2 |
|---|---|---|---|---|---|
| Main use | Architecture you can play and check | Many diagram types inside Markdown | UML and many other diagram types | The C4 model, one model with many views | General diagrams with control over layout and style |
| Request flows | Use cases with `alt` and `par`, played step by step on the diagram | Sequence diagrams, separate from the flowchart | Sequence diagrams, separate from the rest | Dynamic views | Sequence diagrams |
| Load, p99, availability, cost | Simulated from `traffic` | No | No | No | No |
| Requirements and tests | `requirements` and `test` blocks, in CI | No | No | No | No |
| Renders on GitHub | Through the Mermaid export | Natively | No | No | No |

## Where Proschi differs

**The diagram is a model.** Each box has a tech stack from the catalog
(`[Redis]`, `[PostgreSQL]`), and each stack comes with default capacity and
latency. The simulation uses them to say which node saturates first. The
[model page](https://proschi.app/docs/model/) says how far to trust those
numbers.

**Request flows live on the architecture.** A [use case](USE-CASES.md)
can only follow connections the diagram has, and pressing **Play** lights up
each step on the boxes. In the other tools a sequence diagram is a separate
picture that can drift from the architecture.

**The design checks itself.** [Requirements and tests](TESTS.md) such as
`p99 "Redirect" < 50ms` or `no path from any client to any database`
pass or fail in the editor and in `proschi test`, so a pull request that
breaks one fails CI.

**It answers what-ifs.** Raise the traffic, drop a replica or fail a node,
and the numbers change. That is what a design review or a system design
interview asks about.

## Where the others are better

**Mermaid** renders inside GitHub, GitLab and many wikis and note apps
without any setup. It also draws charts Proschi does not, such as class,
state, entity-relationship and Gantt diagrams. If a picture in a README is
all you need, Mermaid is enough.

**PlantUML** covers the full UML set and more, and many wikis and IDEs
have plugins for it. Use it for class or activity diagrams.

**Structurizr** is built around the C4 model: one model, with system
context, container, component and deployment views generated from it. If
your team documents in C4, it fits that process directly. Proschi's
[org diagrams](SYSTEMS.md) cover the team and system level, but not C4's
named views.

**D2** gives you more control over how a diagram looks: several layout
engines, themes and a hand-drawn sketch style. Proschi lays out
architecture diagrams automatically and offers [colors and a few layout
hints](STYLING.md), not free-form styling.

## Use them together

You don't have to choose one for everything. Proschi imports Mermaid
flowcharts and sequence diagrams, and exports every diagram and scenario
as Mermaid, so a README on GitHub can show the picture while the
`.proschi` file stays the source you test. Both directions are in
[Converting Mermaid and OpenAPI](EDITORS.md#converting-mermaid-and-openapi)
and [Rendering and export](EDITORS.md#rendering-and-export).

```sh
proschi import mermaid architecture.mmd > architecture.proschi
proschi render architecture.proschi --out docs --format md
```

## Go further

- [Quickstart](QUICKSTART.md): your first diagram in two minutes.
- [Why architecture diagrams as text](WHY.md): what writing a design as text gives you.
- [Requirements and tests](TESTS.md): the checks the other tools have no equivalent for.
