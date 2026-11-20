---
updated: 2026-11-20
---

# Build a diagram without code

You will end with a client, an API and a database, connected, and a use
case you can play, without typing Proschi. The
[editor](https://proschi.app/app/) writes the text for you.

```proschi
shopper "Shopper" [Actor]
orders_api "Orders API" [REST API]
shopper -> orders_api : HTTP
postgresql "PostgreSQL" [PostgreSQL]
orders_api -> postgresql : SQL

usecase "Place order" {
  shopper -> orders_api : POST /orders
  orders_api -> postgresql : INSERT order
  orders_api --> shopper : 201
}
```

> **Try it:** press **Open in editor**, click **Orders API**, press **A**,
> type `redis` and press **Enter**. A Redis box appears, connected from
> Orders API with the label `RESP`.

## 1. Pick Visual or Code

The **Code | Visual** switch in the header, or **Ctrl+\\** (**⌘\\** on a
Mac), changes the mode. A first visit opens in Visual. Practice and the
mock interview use the same switch.

- **Visual** gives the page to the canvas, with a rail of three tabs:
  **Components**, **Flows** and **Selection**. **View code** shows the text,
  read-only.
- **Code** puts the text editor beside the diagram. The diagram only looks:
  select, pan, zoom and play, but edit in the text.

## 2. Add components

On an empty canvas, a starter such as **Client → API → Database** adds three
connected components in one click. After that, open **Add component** (top
left) for the **Components** tab:

- Click a component to add it. With a component selected, the new one is
  connected from it.
- Type in the search and press **Enter** to add the first match.
- Drag one onto the canvas to place it.
- Hover a component and click its **+**, or let go of a new connection on
  empty canvas. A small picker adds the next component, connected.

A new component starts with its name ready to type. Double-click it or
press **F2** to rename it later. While the id is still the generated one
(`rest_api`, `postgresql2`), it follows the name: "Orders API" makes it
`orders_api` everywhere. An id you typed never changes.

## 3. Connect two components

Drag from the dot under one component and drop anywhere on the other. The
connection is labelled with the protocol of the type it reaches: `SQL` for
PostgreSQL, `RESP` for Redis, `HTTP` for a REST API. A type without a
protocol, such as a message queue, gets a bare arrow.

## 4. Change a type and its settings

Select a component and the **Selection** tab shows its settings: name,
type, replicas, owner, description and [capacity](HLD.md#capacity). Click
the **Type** field, or press **T**, for a type picker that lists the
design's own [types](TYPES.md) first, under "In this design", then the
catalog.

The type card below lists its protocol, the operations it **Reads**,
**Writes** and **Passes on**, and the statuses it **Answers** with: the
words a step to it can use.

## 5. Build a use case

The **Flows** tab builds [use cases](USE-CASES.md) step by step.

1. Click **New use case** and name it.
2. Click **Add a step**, then the component it starts at and the one it
   goes to.
3. Pick the kind: **Request**, **Response**, **Message** (sent without
   waiting) or **Fails** (a call that never gets an answer).
4. Pick an operation from the list and click **Add step**.

The form stays open for the next step, from where the last one ended.
**Reply** answers the open request in one click. Warnings show before you
add the step.

The operations come from the target's type: PostgreSQL offers `SELECT` and
`INSERT`, a REST API its HTTP methods, a response its statuses. **Headers,
payload and fan-out** adds headers from the type, a payload, calls per
request and payload size. Headers need an HTTP method and path first, and a
response takes only a payload. If the type lists no operations, **Give …
operations of its own** writes a [type](TYPES.md#declare-a-type) from the
steps you used, so the next ones are checked.

You can edit, move, delete or insert before any step, rename use cases and
[scenarios](SCENARIOS.md), and start a new path with **Add scenario**. The
builder shows [parallel blocks](SCENARIOS.md#parallel-steps) and edits
their steps, but it can't create one: write `par` in Code mode.

## 6. Work from the keyboard

Click the canvas first. **?** lists every shortcut.

| Key | What it does |
|---|---|
| **A** or **Ctrl+K** (**⌘K**) | The command bar: type plain words, like `redis` or `rename`, and **Enter** adds the component or runs the action. |
| **Tab**, **Shift+Tab** | Select the next or previous component. |
| **C** | Add a component connected from the selected one. |
| **F2** | Rename the selected component. |
| **T** | Change its type. |
| **+**, **-** | More or fewer replicas. |
| **R** | Lay out again, when you have dragged components into place. |

## 7. Ask the AI in Visual mode

The Design partner, and the Interview coach on the interview prep stages,
follow the mode. In Visual they talk in components and steps, show no code
unless you ask, and show each change as a diagram preview to accept. In
Code they show the code change.

## Go further

- [Editing on the canvas](STYLING.md#editing-on-the-canvas): what each
  edit writes.
- [Use cases](USE-CASES.md): the steps as text.
- [Component types](TYPES.md): operations, statuses and headers.
- [Quickstart](QUICKSTART.md): a first diagram in code.
