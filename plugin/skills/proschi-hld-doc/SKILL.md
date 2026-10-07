---
name: proschi-hld-doc
description: Produce a high-level design (HLD) document from a Proschi (.proschi) file with `proschi render --format hld-md` or `hld-html` (overview, requirements, capacity estimates, components, data model, APIs, scenarios, decisions, risks, with diagrams), after enriching the model with the summary, descriptions, entities and decisions the document is built from. Use when the user asks for a design doc, HLD, architecture document, RFC appendix or design review handout for a system described in Proschi, or wants the diagrams exported as SVG, Markdown or HTML for a wiki or docs site.
license: MIT
---

# HLD document from a Proschi design

Goal: a design document generated from the `.proschi` file (so it never
drifts from the diagram), with every section filled from the model, written
to the repo's docs folder, plus a share link to the live diagram.

Syntax: [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md).

## 1. Know where each section comes from

`proschi render --format hld-md` builds the document from the model and
leaves out sections that have no content:

| Section | Comes from |
|---|---|
| Overview | `title "Name" "Summary"`, the architecture diagram, counts of components, use cases, teams |
| Requirements | use cases (description, scenarios, `when` conditions); each `requirements` line and `test` block with pass/fail and the measured value |
| Capacity estimates | `traffic`; load, utilisation, replicas and cost per node (from the simulation) |
| Components | name, tech, kind, `@team`, `xN`, the node description, entities stored |
| Data model | `entity` blocks |
| APIs | use cases grouped by endpoint: request body and each scenario's entry response |
| Scenarios | per scenario: condition, traffic share, latency, sequence diagram |
| Decisions | `decision` blocks with `because` and `rejected` options |
| Risks | failing checks, hot (>70%) or saturated nodes, single points of failure, use cases without an error scenario |

## 2. Enrich the model (ask before inventing)

A thin model gives a thin document. Fill the gaps from the code, ADRs, README
and the user; mark guesses with `# GUESS:` and confirm them:

- `title "Checkout" "Takes payment and records orders for the web shop"`.
- A description string on each important node: `api "Shop API" [Node.js] @shop "Validates carts, charges cards, records orders"`.
- `usecase "Place order" "Customer pays for the cart"` descriptions and
  `alt "…" when "…"` conditions.
- `entity` blocks for the main tables/collections, `in` their store.
- `decision` blocks for choices already made (from ADRs, PR discussions):

```proschi fragment
entity Order in db "One paid order" {
  id        uuid key
  userId    uuid index
  total     int
  createdAt time index
}

decision "Charge before writing the order" {
  because "A failed charge must not leave an order behind"
  rejected "Write first, charge async" "Orders without payment need cleanup jobs"
}
```

- `traffic` and `requirements` make the capacity and risks sections
  meaningful (the `proschi-capacity-plan` skill).

## 3. Validate

```sh
npx proschi@latest fmt design.proschi
npx proschi@latest check design.proschi
npx proschi@latest test design.proschi
```

`render` refuses a document with errors, so fix them first. Failing tests
are fine to render (they become Risks), but tell the user.

## 4. Render

```sh
npx proschi@latest render --format hld-md   --out docs design.proschi   # docs/design.hld.md (Mermaid diagrams; GitHub/GitLab render them)
npx proschi@latest render --format hld-html --out docs design.proschi   # docs/design.hld.html (one self-contained page with SVGs)
```

Other exports for wikis and docs sites:

```sh
npx proschi@latest render --out docs/diagrams design.proschi            # architecture.svg + <usecase>--<scenario>.svg
npx proschi@latest render --format md --out docs design.proschi         # Mermaid blocks only
npx proschi@latest render --format html --out site design.proschi       # every SVG on one page
```

Read the generated file once. If a section is empty or wrong, fix the model
(not the generated file) and render again. Hand-written context (goals,
non-goals, rollout, open questions) goes in a separate Markdown file that
links to or includes the generated one, so re-rendering never loses it.

## 5. Hand over

```sh
npx proschi@latest share-link design.proschi
```

Give the user the document path, the link to the live diagram (playback of
every scenario, *HLD* tab with the same document), and the gaps you could
not fill. Suggest regenerating the HLD in CI or with the
`proschi-keep-in-sync` skill when the model changes.

## Worked example

For the `checkout.proschi` below:

```sh
npx proschi@latest check checkout.proschi
npx proschi@latest render --format hld-md --out docs checkout.proschi
```

writes `docs/checkout.hld.md` with *Overview, Requirements (Functional,
Non-functional), Capacity estimates (Traffic, Load per component),
Components, Data model (Order in Shop DB), APIs (`POST /orders`), Scenarios
(Paid, Payment failed (error)) and Decisions*. There is no *Risks* section
because nothing fails, saturates or stands alone; there is no *Flow tests*
section because the file has no `test` block. Add one (e.g.
`"Place order" writes db before responding`) and render again.

```proschi
title "Checkout" "Takes payment and records orders for the web shop"

user   "Customer" [Browser]
api    "Shop API" [Node.js]    @shop x2 "Validates carts, charges cards, records orders"
db     "Shop DB"  [PostgreSQL] @shop x2
stripe "Stripe"   [Stripe]

user -> api
api  -> db
api  -> stripe

usecase "Place order" "Customer pays for the cart" {
  user -> api    : POST /orders {"sku": "A1"}
  api  -> stripe : CHARGE card
  alt "Paid" {
    api  -> db   : INSERT order
    api --> user : 201 {"id": "o-1"}
  } alt "Payment failed" when "card declined" {
    api --> user : 402 {"error": "payment_failed"}
  }
}

traffic {
  "Place order" 50 rps mix "Paid" 98%, "Payment failed" 2%
}

requirements {
  p99 "Place order" < 1s
  durable "Place order"
}

entity Order in db "One paid order" {
  id     uuid key
  userId uuid index
  total  int
}

decision "Charge before writing the order" {
  because "A failed charge must not leave an order behind"
  rejected "Write first, charge async" "Orders without payment need cleanup jobs"
}
```
