# Draw systems by typing

Proschi is a small text language for architecture diagrams and high-level
designs. You write the services, stores and queues of a system and the
requests that flow between them; Proschi lays out the diagram, plays every
request step by step, and checks the design against the traffic and
requirements you write next to it.

```proschi
title "Notes"

user "User"      [Actor]
api  "Notes API" [REST API]   @backend
db   "Notes DB"  [PostgreSQL] @backend

user -> api : HTTPS
api  -> db  : SQL

usecase "Create a note" {
  user -> api : POST /notes json {"text": "Buy milk"}
  alt "Saved" {
    api  -> db   : INSERT note
    api --> user : 201 {"id": 42}
  } alt "DB down" {
    api  -x db   : INSERT note
    api --> user : 503
  }
}
```

## Why text

- **It diffs.** A design is a file next to the code, reviewed in pull
  requests like the code. No exported PNG that drifts from the system.
- **It lays itself out.** You never drag a box. Add a line and the diagram
  follows; pin a node with `pos` only when you want to.
- **It plays.** A use case is a real request flow: each step names its
  endpoint, payload and status, and `alt` keeps the happy path and every way
  it fails side by side.
- **It checks itself.** With `traffic` and `requirements`, a deterministic
  simulation tells you which node saturates first, what p99 to expect,
  whether the design survives a node failure and what it costs.
- **It stays yours.** The editor runs entirely in your browser. Your diagrams
  are saved there and travel in share links, never on a server. See
  [Privacy](PRIVACY.md).

## Start here

1. [Quickstart](QUICKSTART.md): your first diagram in two minutes.
2. [Language reference](LANGUAGE.md): every statement, with the grammar.
3. [How the simulation works](https://proschi.app/docs/model/): the
   formulas, the default numbers, and how far to trust them.
4. [Editor support](EDITORS.md): VS Code, IntelliJ, Neovim, Helix, Sublime
   Text, the command line and CI.
5. [Practice](https://proschi.app/practice/): system design problems with
   tests instead of opinions, and [how to write one](PRACTICE.md).

Proschi is free and open source under the MIT license. The code is on
[GitHub](https://github.com/gvart/proschi).
