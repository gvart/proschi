---
title: Collaborative Docs
summary: Google Docs-style editing, one sequencer per document, a log written before the ack, pub/sub fan-out.
difficulty: hard
tags: [websocket, pub-sub, presence, consistency, durability]
hints:
  - "Send operations, not documents: each keystroke batch is a small operation against the revision the editor last saw. One service owns each open document, transforms concurrent operations into one order and numbers them."
  - "The ack means \"saved\": append the transformed operation to a durable log before you answer the editor. Everything the collaborators see comes after that."
  - "Collaborators are connected to other session servers. Publish each operation on the document's channel of a pub/sub bus, after the ack (->>), and let every subscribed session server deliver it (x2) to its own connections. Cursors take the same road but are never stored."
  - "Opening a document must not replay months of operations: read the latest snapshot from object storage, then the few operations after it. A snapshotter writes a new snapshot every hundred or so operations. Every delivery passes through a session server, so size them for about 36k messages a second."
---

Design the editing service behind a Google Docs-style editor. Several
people have the same document open; each keystroke shows up on everyone
else's screen within a fraction of a second, concurrent edits never
clobber each other, and nothing a user saw as saved is ever lost.

## Functional requirements

- **Edit**: an editor's browser sends an operation (an insert or delete,
  batched over a few hundred milliseconds of typing) against the revision
  it last saw. The service orders it against concurrent operations, stores
  it and acknowledges it with its revision number; then every collaborator
  receives it.
- **Move cursor**: an editor moves the cursor or changes the selection,
  and the collaborators see it move.
- **Open document**: someone opens a document and gets its current text
  and revision.
- **Save snapshot**: every few hundred operations, a background job folds
  the operations since the last snapshot into a new full copy of the
  document.

Use these use case names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- **Edit: 4k rps** and **Move cursor: 8k rps** at peak, across about a
  million open documents.
- Each edit and each cursor move goes to **2 collaborators** on average,
  and they are almost never connected to the same session server as the
  editor or each other.
- **Open document: 500 rps**; a document's snapshot is about **50 KB**.
- **Save snapshot: 40 rps**, one for every hundred operations.

## Constraints

- The ack is a promise: an operation is in a durable log before its editor
  is told it is saved.
- Collaborators receive an operation only after it is stored, and the
  editor never waits for their deliveries.
- Cursor moves are broadcast but never stored.
- Opening a document never replays its whole history.
- p99 of **Edit** under **100 ms**, of **Move cursor** under **60 ms**, of
  **Open document** under **400 ms**.
- Editing available **99.95%** of the time.
- Losing any single machine must not take editing down.
- At most **$6,500 / month**.

## What is given

`problem.proschi` declares the `editor` (the browser of the person typing)
and the `collaborators` (everyone else with the document open), and holds
the traffic, requirements and tests. Add the components, the connections
and the four use cases.

The simulation does not run operational transformation: model the service
that orders and transforms operations as a component that is called, and
explain your choice in a `decision`. Write a delivery to the collaborators
with the fan-out prefix, `x2`, so the simulation counts every message.
