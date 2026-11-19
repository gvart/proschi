# Visual editor review: adding components and the Flows editor

Scope: (A) adding, placing, connecting, naming and typing components (palette, canvas, Inspector) and (B) the Flows editor (use cases built from request, response and message steps). Other canvas features are left out.

Method: read the code listed in the brief, then drove the playground in Chromium at 1440×900 as a first-time user. Paths are under `frontend/src/`. Screenshots (`NN-*.png`) are next to this file. Palette drag-and-drop, the phone layout and the practice canvas (`EditableCanvas`) were not exercised; claims about them cite code only. In `11` and `13` the canvas toolbar is scrolled out of view: that came from the automation and is not a finding.

## 1. Current problems, ranked by impact

### B. Flows editor

1. **Step labels are hard-coded and ignore the type system.** `components/Diagram/flows.ts:29-47` switches on the target's *kind* and returns fixed strings. The builder then writes labels its own language rejects:
   - It offers `query` for PostgreSQL; adding it produces "PostgreSQL has no operation 'query'" (`24-flow-built.png`).
   - A user type `OrdersDb extends PostgreSQL { op write RESERVE; op read BALANCE }` is still offered `SELECT | INSERT | UPDATE | query`; its own ops never appear.
   - Responses are always `200 OK | 201 Created | 302 Found | 404 Not found | ok | result`, also when PostgreSQL answers (`22-step-form-db-response.png`), and a type's own `status 409` is never offered.
   - Only the target is looked up (`FlowsPanel.tsx:403`); a response's statuses belong to the responder (`from`).
   - A message to a Worker offers `SET | notify | log`.
   - Headers, payload, `x<N>`, `~size` and the connection's protocol have no UI at all.
   - The code editor already does this correctly from `resolvedType` (`components/Playground/proschiLanguage.ts:303-330`); the builder does not share it.
2. **A step can only be appended or deleted.** `StepRow` (`FlowsPanel.tsx:283-300`) has one button, delete. No editing a label, no reorder, no insert in the middle. `dsl/edit.ts` has only `addStep` (append) and `removeStep`. A typo means delete and rebuild, or go to the code.
3. **Each step costs about six actions and the loop resets every time.** Add a step, click source, click target, check kind, pick label, Add step; then the form closes (`FlowsPanel.tsx:247`). The next step does not start from where the last one ended, though that is the usual case.
4. **Code the builder cannot show.** `par { }` renders as "A block written in the code (line 33)" (`FlowsPanel.tsx:210`, `25-loaded-code.png`), because `outlineOf` does not model it. A failed call (`-x`) is read by the outline but drawn like a request, and cannot be created (`FlowsPanel.tsx:285`, `444`). Loading existing code therefore loses parts of the flow in the panel.
5. **Starting is hidden.** With no use case, the only way to create one is to open a select that reads "No use cases yet" and find "+ New use case…" inside (`16-flows-empty.png`, `17-flows-select-open.png`).
6. **Rows are inert and silent.** Clicking a step does nothing: no highlight on the canvas, no jump to its line. A step with a warning looks like any other; the warning is only in the code pane's footer.

### A. Adding components

1. **Connecting is fiddly, and fails silently.** The only drag target is a 9 px dot (`components/Canvas/canvas.css:129-135`) that scales with zoom: 2.6 px to 6.8 px in my runs. In a controlled pair at zoom 0.76, dropping on the target's body did nothing and dropping on its dot connected. No feedback says why. The keyboard path ("Connect to…") is only in the right-click menu.
2. **New components arrive tiny and unconnected.** Five palette clicks give a row of boxes about 70×17 px, because the fit shrinks the row into a 440 px wide canvas (`05-four-nodes.png`). Adding never connects to the selection, so every add is followed by problem 1.
3. **Names and ids are the tech's.** A click writes `postgresql "PostgreSQL" [PostgreSQL]`, then `postgresql2` (`Playground.tsx:843`). Rename is a modal dialog (`DiagramView.tsx:655`, `08-rename-dialog.png`) and changes only the display name (`dsl/edit.ts:29`): the code keeps `rest_api "Orders API"` forever. There is no edit for an id.
4. **The Inspector covers the canvas and knows nothing about types.**
   - It floats over the right 288 px of an already narrow canvas and hides nodes (`26-inspector-over-canvas.png`).
   - Tech is a free-text `<datalist>` of catalog names only (`Inspector.tsx:48`, `135-146`): types declared in the document are not offered, and a typo (`Memcachd`) is written to the code with the warning shown only in the code pane (`13-typo-tech.png`).
   - It never says what the type is: no doc, no protocol, no operations.
   - Half of it is capacity fields a first-time user does not need yet.
5. **Connections are born without a protocol.** `addConnection` writes a bare `a -> b` (`dsl/edit.ts:43-48`), though the target's type declares `protocol SQL`, `RESP`, `HTTP`. The edge Inspector is one free-text field, "Label or protocol" (`27-edge-inspector.png`).
6. **Overlapping chrome.** The "Start a diagram" card sits over the open palette (`03-palette.png`); the connect hint covers the Add component button (`05-four-nodes.png`).
7. **No keyboard path to add.** Shortcuts cover find, copy, paste, duplicate, delete (`ShortcutsDialog.tsx:29-43`); nothing adds a component, connects, renames or changes a type. Enter in the palette search does add the first match, but nothing says so.

Working well and worth keeping: the text as the single source of truth, one undo stack, selection linked to the code line, the palette's grouping by role, and "Connect to…" with the node finder.

## 2. New design

Principle: **the canvas, the Flows panel and the code are three views of one text, and every list the UI offers comes from the document's types.** No UI string names an operation, status, header or protocol. The one list that stays is the language's own: the HTTP methods the grammar reads in a label (`HTTP_METHODS`, already used by completion for types whose protocol is HTTP).

The same pieces serve the playground, practice problems and the interview room (design note P46 in `docs/design/paid-plans.md`). Starter chips, tour steps and the type card's simulation numbers are playground-only, so practice gives nothing away; the type-driven composer applies everywhere.

### Layout

- One side rail beside the canvas with three tabs: **Components**, **Flows**, **Selection**. This is today's `PaletteDock`, which already hosts all three. Nothing floats over the diagram on desktop.
- The fit never goes below a readable zoom while editing (about 0.6); beyond that the canvas pans to the newest node instead of shrinking everything.
- A **Canvas / Split / Code** switch in the tab bar. Split stays the default; Canvas gives a first-time user the full width.

### Adding components: first-time path

1. **Empty canvas**: three starter chips ("Client → API → Database", "Add a cache", "Add a queue and worker") plus the Components rail open. The card is centred on the canvas, not the pane.
2. **Add is contextual.** With a node selected, clicking a palette entry adds the new component *connected from the selection*. With nothing selected it adds it alone.
3. **A "+" on each side of a hovered node** opens a small type picker in place; choosing one adds a connected component. Dragging from a node and releasing on empty canvas opens the same picker.
4. **Connecting**: drag from anywhere on the node's edge and drop anywhere on the target's body. The target highlights while hovered. Hit targets do not shrink with zoom.
5. **Name it in place.** A new component's name is in edit mode on the canvas: type, Enter. Double-click and F2 do the same later. No modal.
6. **Ids follow names** while the id is still the generated one: naming `rest_api` "Orders API" rewrites the id to `orders_api` everywhere it is referenced. An id the user wrote is never touched.
7. **Connections get their protocol.** A new connection is labelled with the target type's `protocol` (`api -> db : SQL`). Types without one get a bare arrow.

### The Selection tab (replaces the floating Inspector)

- **Name**, **Type**, **Replicas** on top; owner, description and capacity folded under "More".
- **Type** is one searchable picker used everywhere a type is chosen (palette, "+", here). It lists catalog types *and the document's own types*, each with its `doc` line, and refuses nothing: an unknown name shows the parser's "did you mean" inline, before it is written.
- **A type card** under it, read from `resolvedType`: the doc, the chain (`OrdersDb › PostgreSQL › Database`), the protocol, and its operations grouped into reads and writes, own first. This is where a user learns what a component can be asked.
- For a connection: a protocol picker (the target type's protocol first, then free text).

### Flows: first-time path

1. **Empty state**: a "New use case" button and a name field, plus one-click chips for the use cases the `traffic` block names (already computed by `missingUseCases`).
2. **Steps are built on the canvas.** With Flows open, click the caller, then the callee; or click a connection to send a request along it. The step composer opens in the panel with focus in the operation field.
3. **The chain continues.** After a request `a -> b`, the next step starts at `b`. A **Reply** button answers the latest open request in one click (today's `defaultStepKind` logic, made visible). Enter adds the step and keeps the composer open.
4. **Every row is live**: click to edit in place, drag to reorder, "+" between rows to insert, hover to light up its two nodes and its line in the code. A row with a diagnostic shows it on the row.
5. Scenarios stay as lanes; `par` blocks get a lane of their own; a failed call (`-x`) is a fourth kind.

### The step composer, driven by the type

One function, `stepVocabulary(diagram, from, to, kind)`, feeds both this composer and the code editor's completion. It reads only `resolvedType`; a step to a system's port takes the port's type, as the parser does (`dsl/parser.ts:2761`, `2781`).

| Part | Source | UI |
|---|---|---|
| Operation | The **target's** ops, own first, then each ancestor's (`opNamesMostSpecificFirst`). For a type whose protocol is HTTP, its HTTP methods. | Searchable combobox; each row shows read, write or forward and any `latency` / `cost` multiplier. Operations this document already sends to that node come first. |
| Argument | Free text after the op (`SELECT orders`, `/orders/{id}`). | Text field; for HTTP a path field that suggests paths already used to that node. |
| Headers | The target's `header` list. | Multi-select, shown only when the type lists any. |
| Payload | The label grammar (`json`, `xml`, `text`, or a body). Types carry no payload schema. | A collapsible body field. |
| Fan-out, size | `x<N>`, `~<size>` prefixes. | Two small fields under "More". |
| Status | The **responder's** `status` list. | Searchable list grouped 2xx to 5xx, with the statuses this document already uses first. |
| Protocol | The connection's label, else the target type's `protocol`. | Shown as a badge on the step; not editable here. |

Rules for what the lists cannot cover:

- **A type with no operations** (`Service`, `Worker`, `gRPC`): a plain text field, with the labels this document already sends to that node as suggestions, and a note: "Service takes any label. Give it operations with a type." A link writes `type Orders extends Service { op … }` from the labels in use.
- **A responder with no statuses** (PostgreSQL, Redis): a plain text field ("what comes back, e.g. 1 row"). No HTTP codes.
- **Free text always works**, as in the language. The composer parses the candidate line and shows the diagnostic it would get before it is added, so the builder never writes a warning silently.

Lists are long (Redis has well over a hundred operations, HTTP types about 60 statuses and 80 headers), so every list is a filterable combobox, never pills. Ranking uses only the type chain and what the document already uses.

### Power-user path

- **Quick-add bar** (`A`, or `Cmd/Ctrl+K`): type a line of Proschi and press Enter. `cache "Sessions" [Redis] x2`, `api -> cache`, or just `redis` (resolved through the catalog). It is parsed by the real parser and completed by the editor's completion source, so there is no second syntax. With a node selected, a new component is connected from it.
- **In Flows**, the same bar adds a step: `api -> db : SELECT orders`, with the operations of `db` completing after the colon.
- **Keys on the canvas**: `Tab` adds a connected component after the selection, `C` connects to… (today's finder), `Enter` or `F2` renames, `T` changes the type, `+` / `-` change replicas, `F` opens Flows, `R` replies in Flows.
- `Cmd/Ctrl+K` with no text lists every action, with its key.

### Code generation, loading and round-trip

- The text stays the only state. Every gesture is one `dsl/edit.ts` edit and one undo step, as today.
- **Loading existing code** shows everything: `par`, `alt`, `-x`, multi-line payloads and steps through ports are rendered, and anything the builder cannot edit is shown read-only with a "Edit in code" jump, never hidden behind a line number.
- **Round-trip guarantee, tested**: an edit made in the builder changes only its own lines, byte for byte, and comments and alignment elsewhere survive; for every built-in type, every label the composer offers parses with zero diagnostics.
- Selection is linked three ways: a step row, its nodes and connection on the canvas, and its line in the code.

### Onboarding

- The quick tour gains two steps on a blank diagram: "Add a component and connect it" and "Record a use case".
- One-line hints at the point of use replace the footer sentence: on first hover of a node ("Drag from the edge to connect, or press +"), on first step ("Operations come from Orders DB's type, PostgreSQL").

## 3. What's new (for the blog post)

**Building the diagram**
- Add a component already connected to the one you selected, from the palette or the new "+" on a node.
- Drop a connection anywhere on a component; no more aiming at a dot.
- Name a component right on the canvas as you add it, and its id follows the name.
- New connections are labelled with the protocol of the type they reach: SQL, RESP, HTTP.
- One side panel for components, flows and settings; nothing covers the diagram.
- A type picker that knows your own types, and a type card that shows what a component speaks and which operations it takes.
- The canvas stays readable while you add: it pans to the new component instead of shrinking the diagram.

**Building use cases**
- Operations, statuses and headers come from each component's type, including types you declare. PostgreSQL offers `SELECT` and `INSERT`; your `OrdersDb` offers `RESERVE`.
- Responses offer the responder's statuses, and only when it has any.
- Add headers, a payload, fan-out and payload size without writing code.
- The flow continues from where the last step ended, and Reply answers the open request in one click.
- Edit, reorder and insert steps; parallel blocks and failed calls show in the builder.
- Warnings appear on the step, before you add it.
- Hover a step to see it on the diagram and in the code.

**For the keyboard**
- A quick-add bar that takes a line of Proschi: `cache [Redis] x2`, `api -> cache`, `api -> db : SELECT orders`.
- Keys to add, connect, rename, retype and reply.

## 4. Implementation slices

Both canvases (`components/Playground/DiagramView.tsx` and `components/Diagram/EditableCanvas.tsx`) wire the palette, Flows and Inspector separately. Each slice that touches wiring either changes both or first moves the logic into `components/Diagram/` (as `useCanvasEdits.ts` did). `e2e/canvas-parity.e2e.ts` checks both.

| # | Slice | Files | Reuse / new | Verify |
|---|---|---|---|---|
| 1 | **Type-driven step vocabulary.** Replace `labelSuggestions` with `stepVocabulary`; the composer's operation and status fields become comboboxes fed by it; responses read the responder. | New `dsl/typesys/vocabulary.ts`; `Diagram/flows.ts`, `FlowsPanel.tsx`; `Playground/proschiLanguage.ts` (`stepOptions` calls it) | Reuses `resolvedType`, `opNamesMostSpecificFirst`, `findOp`. New: the one function. | Unit: for every concrete stdlib type and one user type, each offered operation and status yields a step with no unknown-operation, status or header diagnostic (this pins the `query` bug). `flows.test.ts` rewritten. E2e: the Flows tests in `canvas-parity.e2e.ts` and `interview.e2e.ts` pick `SELECT` for PostgreSQL and see a user type's op. |
| 2 | **Connect that works.** Drop on the body, zoom-independent hit area, hover highlight, protocol label on new connections, protocol picker for a connection. | `Canvas/ComponentNode.tsx`, `Canvas/canvas.css`, both canvases, `dsl/edit.ts` (`addConnection` takes an optional label), `Diagram/Inspector.tsx` | Reuses `setEdgeLabel`, `resolvedType.protocol`. New: label parameter. | Unit: `edit.test.ts` for the label. E2e in `canvas-editing.e2e.ts`: drag to a node's centre at zoom 0.5 writes `a -> b : SQL`. |
| 3 | **Flows loop and empty state.** New use case button, chain continuation, Reply, composer stays open, live diagnostic on the candidate line, row hover linked to canvas and code. | `FlowsPanel.tsx`, `flows.ts`, both canvases (the `pick` state moves to a shared hook) | Reuses `defaultStepKind`, `addStep`, `parse`, the existing `linked` highlight. New: `useStepPick` hook. | Unit: `flows.test.ts` for the next-step default. E2e: five steps in five picks plus five Enters; `canvas-parity.e2e.ts:152` and `interview.e2e.ts:327` change with the new use case button. |
| 4 | **Edit steps; show everything.** Edit, move and insert a step; `par` in the outline; `-x` drawn and creatable; rename a use case or scenario. | `dsl/edit.ts` (`setStep`, `moveStep`, `addStep` with a position, `renameUseCase`, `renameScenario`; `outlineOf` models `par`), `FlowsPanel.tsx` | New edit operations; reuses `outlineOf`, `statementEnd`, `removeStatementLines`. | Unit: `editFlows.test.ts`, including "untouched lines are byte-identical" over the practice problems' solutions. E2e: reorder two steps, see the code. |
| 5 | **Composer details.** Headers, payload, `x<N>`, `~size`, the open-type path and "give it operations". | `FlowsPanel.tsx` (split out `StepComposer.tsx`), `vocabulary.ts`, `dsl/edit.ts` (`addType`) | Reuses the label grammar in the parser. New: a label builder (`composeLabel`) with a parse round-trip test. | Unit: `composeLabel` then parse equals the parts, for every combination. |
| 6 | **Adding flow.** Add connected to the selection, "+" on nodes, drop on empty canvas opens the picker, readable fit, in-place naming, ids follow names, empty-state chips, overlap fixes. | `Diagram/Palette.tsx`, `CanvasEditing.tsx`, `useFitOnChange.ts`, `Canvas/ComponentNode.tsx`, both canvases, `dsl/edit.ts` (`renameId`) | Reuses `addNode`, `addConnection`, `uniqueId`. New: `renameId` (rewrites every reference: connections, steps, capacity, tests, what-ifs). | Unit: `renameId` over every practice solution, then parse equals the original with the id swapped. E2e: three clicks give `client -> api -> db`. |
| 7 | **Selection tab.** Inspector docked in the rail, shared type picker with the document's types, type card. | `Diagram/Inspector.tsx`, new `Diagram/TypePicker.tsx`, `paletteGroups.ts`, `CanvasEditing.tsx` | Reuses `diagram.types`, `lookupType`, `suggestTech`. | Unit: picker lists a declared type. E2e: no element overlaps a node with the panel open (the parity test already measures this for Flows). |
| 8 | **Quick-add bar and keys.** | New `Diagram/QuickAdd.tsx` (from `NodeFinder.tsx`), `canvasEditState.ts` (`canvasKey`), `Playground/ShortcutsDialog.tsx`, `proschiLanguage.ts` (export the completion source) | Reuses the parser, completion, `addNode`, `addStep`. | Unit: `canvasEditState.test.ts`. E2e: `A`, type `cache [Redis]`, Enter. |
| 9 | **Docs and tour.** A docs page for the visual editor (`docs/` has none), tour steps, the blog post. | `docs/`, `docs/site.json`, the tour component | | `docs.e2e.ts`, `onboarding.e2e.ts` |

Slices 1 and 2 are small and remove the two worst failures; 1 alone answers "labels must follow the type". Slices 4 and 6 carry the real engineering risk (`moveStep`, `renameId`), so they come with tests over every practice solution.

## 5. Open decisions

1. **What the composer offers for types without operations or statuses.** Options: (a) free text plus labels already used in the document; (b) grow the stdlib (for example a result vocabulary for stores); (c) require declaring a type. **Recommend (a)**, with the "give it operations" link. It keeps the rule that the UI invents nothing, and (b) is a language change that would start warning on existing diagrams.
2. **Write the protocol on new connections.** It changes generated code from `api -> db` to `api -> db : SQL`. **Recommend yes.** One sub-choice: HTTP types declare `protocol HTTP` while the docs' examples write `HTTPS`; I would write what the type says and leave the stdlib alone.
3. **Ids follow names.** Rewriting `rest_api` to `orders_api` is friendlier code but a larger edit. **Recommend yes, only while the id is the generated one**; otherwise ids from the canvas stay tech names forever.
4. **May the builder add a label that warns?** **Recommend yes, with the warning shown before adding.** Blocking would make the builder stricter than the language; practice problems with `strict: true` would block, as they already turn the warning into an error.
5. **Default view for a new visitor.** The narrow canvas in the three-pane layout is the root of the "tiny nodes" problem. Options: keep Split and cap the fit zoom, or open blank diagrams in Canvas view. **Recommend Split with the zoom cap**: seeing the code appear as you click is the product's pitch.
6. **Payload schema in types.** The owner asked for payload shape from the type; types carry none today. **Recommend not adding it now**: the composer builds payloads from the label grammar, and schema is a language feature to design on its own.
