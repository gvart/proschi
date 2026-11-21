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
wide for it scrolls sideways; before it does, a lane no step in sight uses
folds to a thin icon, which a click shows again. A set of
[scenarios](SCENARIOS.md) is a frame where the flow branches, with a tab for
each scenario: the chosen one's steps show in the frame, between the steps
they all share. The bar names the scenarios shown. The view is remembered,
and the canvas keeps its zoom while you are away.

A small map of the architecture floats in the corner. It lights up the
selected step's components and the connection it travels, and draws a
dashed line where there is none. Collapse it, or press **M**, to keep it out
of the way.

1. Pick a use case in the editor's header. The Flows bar shows its name:
   click it to rename it. Its **⋯** menu adds a new use case or deletes
   this one. (In practice and the interview, the bar has its own picker.)
   With no use case yet, the view asks you to **Name the first use case**.
2. Click **Add step** under the last arrow, or press **N**. A dashed arrow
   starts where the last step ended. An empty use case starts it at the
   user, with every component shown as a dashed lane.
3. Click the component it goes to: its lane, its header or the map. Clicking
   the start's own lane starts over, so you can pick a different start.
4. Type the label on the arrow, or pick an operation from the list. The kind
   (**Request**, **Response**, **Message** or **Fails**) sits under it.
5. Press **Enter** to add the step. The next arrow starts where this one
   went, so you can chain a whole flow. **Escape** stops.

While a request waits for its answer, a **Reply to …** button under the
arrow (or **Enter**) adds the answer back. Warnings show before you add the
step. A scenario frame's **Add step** row adds to the scenario it shows.

**+ Lane**, after the last lane's header, adds a lane for a component the
flow doesn't use yet. A new arrow, or the end of a selected one, can then go
there. Its last choice, **New component…**, goes back to the architecture.

The operations come from the target's type: PostgreSQL offers `SELECT` and
`INSERT`, a REST API its HTTP methods, a response its statuses. **Headers,
payload and fan-out** adds headers from the type, a payload, calls per
request and payload size. Headers need an HTTP method and path first, and a
response takes only a payload. If the type lists no operations, **Give …
operations of its own** writes a [type](TYPES.md#declare-a-type) from the
steps you used, so the next ones are checked.

To add a step in the middle, hover the diagram and click a **+** between
two arrows, or drag from one lifeline to another. The same dashed arrow
starts there, from where the step before it ended, or with both ends when
you dragged.

Click an arrow to select it, and a small toolbar shows under it. The arrows
below move down to make room, so nothing is covered. Every change is written
at once, with no Save:

- **Request**, **Response**, **Message** and **Fails** change its kind.
- Double-click the arrow, or press **Enter**, to edit its label in place,
  with the type's operations listed as you type. **Enter** applies it and
  **Escape** keeps the old one.
- Drag either end of the arrow to another lane to change where the step
  starts or goes. A step can't go from a component to itself.
- **Add reply** answers a selected request right after it. The arrow
  buttons, or **Alt+↑** and **Alt+↓** (**⌥** on a Mac), move it, and the
  bin or **Delete** removes it.
- Drag an arrow up or down by its middle to move it anywhere: a pink line
  shows where it lands, into a frame too. **Escape** cancels the drag.
- **⋯** opens **Headers, payload and fan-out** in a card under the arrow.

Shift-click or Ctrl-click (**⌘**-click) to select several steps. **Run at
the same time** puts them in a [parallel block](SCENARIOS.md#parallel-steps).
They must follow each other in one flow or scenario, or the view says why.
A block's **Ungroup** runs its steps one after another again, and its **Add
alongside** row adds one more step to it.

A scenario frame's tabs are edited in place:

- Click a tab to show its steps. **[** and **]** show the scenario before or
  after the selected step's.
- **+** names a new scenario on its own tab, with the problem's scenarios
  offered under it. **Enter** adds it and **Escape** cancels.
- Double-click a tab, or press **F2** on it, to rename it.
- The **⋯** menu by the chosen tab renames or deletes it.

With no scenario yet, **Add scenario** in the bar starts the first one, in
an empty frame at the end of the flow.

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

In the Flows view, **N** adds a step: at the end, or after the selected
step (**Shift+N** before it). While you pick its target, **←** and **→**
aim at a lane and **Enter** takes it. In its label, **Enter** adds the step
and starts the next, and **Escape** stops.

To edit a step, click it first. **↑** and **↓** select the next
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
