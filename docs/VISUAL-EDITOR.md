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

- **Visual** gives the page to the canvas, with a rail of two tabs:
  **Components** and **Selection** (a phone adds **Flows**). **View code**
  shows the text, read-only.
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

The **Architecture | Flows** switch above the canvas, or **F**, turns the
canvas into the Flows view, and back. It draws the chosen
[use case](USE-CASES.md) as a sequence diagram: a lane per component and a
numbered arrow per step. The lanes fit the width, and only a diagram too
wide for it scrolls sideways. Each [scenario](SCENARIOS.md) has a tab, and
**Add scenario** starts a new one. The view is remembered, and the canvas
keeps its zoom while you are away.

A small map of the architecture floats in the corner. It lights up the
selected step's components and the connection it travels, and draws a
dashed line where there is none. Collapse it, or press **M**, to keep it out
of the way.

1. Pick a use case in the editor's header. The Flows bar shows its name:
   click it to rename it. Its **⋯** menu adds a new use case or deletes
   this one. (In practice and the interview, the bar has its own picker.)
2. Click **Add a step** in the bar. Then click the component it
   starts at and the one it goes to: on the map, on its lane's header or
   lifeline, or in the form.
3. Pick the kind: **Request**, **Response**, **Message** (sent without
   waiting) or **Fails** (a call that never gets an answer).
4. Pick an operation from the list and click **Add step**.

The form stays open for the next step, from where the last one ended.
**Reply** answers the open request in one click. Warnings show before you
add the step. On a scenario's tab, steps go into that scenario.

The operations come from the target's type: PostgreSQL offers `SELECT` and
`INSERT`, a REST API its HTTP methods, a response its statuses. **Headers,
payload and fan-out** adds headers from the type, a payload, calls per
request and payload size. Headers need an HTTP method and path first, and a
response takes only a payload. If the type lists no operations, **Give …
operations of its own** writes a [type](TYPES.md#declare-a-type) from the
steps you used, so the next ones are checked.

To add a step in the middle, hover the diagram and click a **+** between
two arrows, or drag from one lifeline to another. A small form opens there,
starting where the step before it ended. **Goes to** lists every component,
and one that is not in the use case yet gets its own lane. A step can't go
from a component to itself.

Click an arrow to select it, and a small toolbar shows over it. Every change
is written at once, with no Save:

- **Request**, **Response**, **Message** and **Fails** change its kind.
- Double-click the arrow, or press **Enter**, to edit its label in place,
  with the type's operations listed as you type. **Enter** applies it and
  **Escape** keeps the old one.
- Drag either end of the arrow to another lane to change where the step
  starts or goes. A step can't go from a component to itself.
- **Add reply** answers a selected request right after it. The arrow
  buttons, or **Alt+↑** and **Alt+↓** (**⌥** on a Mac), move it, and the
  bin or **Delete** removes it.
- **⋯** opens **Headers, payload and fan-out** in a card under the arrow.

Shift-click or Ctrl-click (**⌘**-click) to select several steps. **Run at
the same time** puts them in a [parallel block](SCENARIOS.md#parallel-steps).
They must follow each other in one flow or scenario, or the view says why.
A block's **Ungroup** runs its steps one after another again, and **Add
alongside** adds one more step to it.

With a scenario's tab open, the pencil and bin beside its tab rename or
delete that scenario.

Every change edits the text. **Ctrl+Z** (**⌘Z**) undoes it in Visual mode,
and Code mode has it in the code editor's history too. On a phone, Flows is
a sheet under the canvas with the steps as a list: tap a step to edit it,
and its row moves it or inserts a step before it.

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
| **F** | Switch between the architecture and Flows. |

In the Flows view, click a step first. **↑** and **↓** select the next
step, **Shift+↑** and **Shift+↓** select several, and **Escape** lets it
go. **Enter** edits its label. **1** to **4** set its kind (request,
response, message, fails), **R** adds its reply, **D** opens its details
and **X** swaps its ends. **Alt+←** and **Alt+→** move where it goes a lane
over, and with **Shift** where it starts. **Tab** reaches its toolbar,
whose buttons the arrow keys go along. **M** shows or collapses the map.

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
