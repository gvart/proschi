# Collaborative Docs: one order, one log, many screens

```tldr
Browsers send small **operations**, not documents. **One owner per document** orders them (with OT), **appends each to a log before the ack**, and only then **publishes it over pub/sub** to the session servers holding the collaborators. **Cursors** ride the bus but are never stored, and **snapshots** keep opening a document fast instead of replaying its whole history.
```

Two people type into the same paragraph at once. Each sees their own letter immediately, moments later both see both letters in the same order, and a server crash a second after loses neither. Google Docs, Notion and Figma all do this with the same few rules.

## What you'll learn

- Why editors exchange operations, and how operational transformation (OT) and CRDTs make concurrent operations converge.
- Why each open document gets a single owner that sequences its operations, and how requests find it.
- Why the ack waits for the operation log and the broadcast does not.
- How pub/sub carries operations and cursors to collaborators on other session servers.
- Why presence is ephemeral, and how snapshots keep opening a document fast.

## The problem, explained

**Who uses it.** People writing together: a few collaborators per document, about a million documents open at peak.

**Functional requirements.**

- **Edit**: the browser sends an operation against the revision it last saw; the service orders it, stores it, acknowledges it with a revision number and delivers it to the collaborators.
- **Move cursor**: cursor and selection changes reach the collaborators.
- **Open document**: the current text and revision.
- **Save snapshot**: a background job folds recent operations into a full copy.

**Non-functional requirements.**

| Requirement | Target |
|---|---|
| Durability | An operation is durable before its ack |
| Ordering | Collaborators get it only after it is stored; the editor never waits for them |
| Presence | Cursors are never stored |
| Opening | Never replays the whole history |
| p99 (the latency 99% of requests beat) | Edits under 100 ms, cursors 60 ms, opening 400 ms |
| Availability | Editing 99.95%; any machine can fail |
| Budget | At most $6,500 a month |

**What is given, and why.** Only the two kinds of browsers, the editor and the collaborators. Everything between is yours; the tests describe guarantees, not boxes.

**What the tests check.**

- *An edit is in the operation log before it is acknowledged*: Edit starts at the editor and writes a database before answering.
- *Collaborators get an edit after it is stored, through pub/sub*: Edit never waits for the collaborators, reaches them after the database, and passes a queue (the bus) on the way.
- *Cursor moves are broadcast, never stored*: Move cursor reaches the collaborators without waiting for them and never touches a database or storage.
- *Opening a document starts from a snapshot*: Open document reads storage before the log, and Save snapshot writes storage after reading the log.

## Back-of-the-envelope

```numbers
12k/s | messages in (4k edits + 8k cursors)
36k/s | through the session servers
≈ 26 | session servers under 70%
4k/s | log appends
25 MB/s | opening from snapshots (vs 1 GB/s replaying)
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Messages in from editors | 4k edits + 8k cursors | 12k/s |
| Messages out to collaborators | 12k × 2 | 24k/s |
| Session server messages | 12k in + 24k delivered | 36k/s |
| Session servers at 2k/s, under 70% | 36k ÷ (2k × 0.7) | about 26 |
| Log appends | one per edit | 4k/s |
| Operations a day | 4k × 86,400 | about 350 million |
| Log size a day | 350M × ~200 bytes | about 70 GB |
| Snapshot reads | 500 opens × 50 KB | 25 MB/s |
| Replaying a long history instead | 500 × ~2 MB | 1 GB/s |

**The session servers carry the fan-out.** Every message arrives at one session server and leaves through others: 36k a second, three times the incoming rate.

```callout pitfall Count the fan-out
In Proschi, put `x2` on the bus's delivery to the session servers and on their push to the collaborators. Without it the model counts one message where there are three, and the servers look idle.
```

**The log is not the bottleneck.** 4k appends a second is modest for a partitioned store. What matters is appending before the ack and never reading the log whole.

**Latency.** An edit is load balancer → session server → collab service → log append, then the ack: three short hops and a write, about 25 ms on average, with room to the 100 ms p99. The deliveries come after the ack and do not count.

## Concepts

### Operations, not documents

Sending the whole document per keystroke is heavy, and two people saving at once overwrite each other. So the browser sends *operations* (insert "a" at position 120, delete 3 characters at 87), each tagged with the revision it was made against. The server keeps an ordered list of accepted operations; revision n is the first n applied. That list, the operation log, is the document's source of truth.

The browser applies its own operations immediately and keeps unacknowledged ones in a pending buffer.

### Operational transformation and CRDTs

Alice inserts "x" at position 5 while Bob deletes the character at position 2, both against revision 41. Applied naively in different orders, their documents diverge. Two families of algorithms fix this.

**Operational transformation (OT).** The server picks an order. When Bob's delete arrives after Alice's insert was accepted as revision 42, the server *transforms* Bob's operation against Alice's and accepts the result as revision 43. Here nothing shifts, since the delete is before the insert; had Bob deleted at 7, his position would become 8. Each client transforms incoming operations against its pending ones the same way.

**CRDTs** (conflict-free replicated data types). Every character gets a unique, ordered id, so operations commute: any replica that has seen the same set of operations has the same text, whatever the arrival order, with no central order.

| | OT | CRDTs |
|---|---|---|
| Ordering | A single authority per document chooses it | None needed |
| Cost | Needs that authority | Metadata per character, tombstones for deletions |
| Gain | Simple and light with a server in the middle | Offline editing, peer-to-peer sync |
| Used by | Google Docs, Etherpad | Yjs, Automerge (libraries) |

With a server in the middle anyway, OT with one sequencer per document is the simpler fit, and this design uses it. A CRDT would still need the log, snapshots and fan-out.

```quiz
crdts
```

### One owner per document

Ordering needs one place that decides. Route a document's operations to one collab service instance, by consistent hashing of the document id or a lease in a coordination service. It keeps recent operations in memory, transforms each new one, assigns the next revision and appends it to the log: no locks, no consensus round per keystroke.

```deepdive When the owner fails
Another instance takes the lease, reads the document's latest revision from the log and continues. Clients resend their unacknowledged operations, which the new owner transforms against whatever was committed. Since the log already holds every acknowledged operation, nothing acknowledged is lost.
```

### Durable before acknowledged

The ack turns "saving…" into "saved", so the collab service appends to the log, waits for confirmation, then acknowledges. Crash after the ack but before the write, and the user loses text they saw as saved, while collaborators who applied it disagree with the log forever.

```callout takeaway
**Log, then ack, then broadcast.** The ack waits for the durable append; the broadcast waits for nobody.
```

````deepdive The same order in Proschi
A comment service stores first, answers, then publishes asynchronously:

```proschi
title "Comment service"

reader  "Reader"   [Actor]
api     "Comments" [REST API]  x2
store   "Comments" [Cassandra] x3
notices "Notices"  [Kafka]     x2

reader -> api     : HTTPS
api    -> store   : CQL
api    -> notices : produce

usecase "Post comment" {
  reader  -> api     : POST /threads/7/comments
  api     -> store   : INSERT comment c_9
  store  --> api     : ok
  api    --> reader  : 201
  api    ->> notices : CommentPosted c_9
}
```
````

```quiz
ack-after-store
```

### Fan-out through pub/sub

The load balancer spreads WebSocket connections over many session servers, so collaborators are almost never on one. After the ack, the collab service publishes the operation on the document's subject of a pub/sub bus (NATS, Redis pub/sub, Kafka). Each session server with a connection to the document subscribes while it is open and pushes operations to its connections.

The editor waits for none of this, or a slow browser would slow everyone's typing. A collaborator that misses a message (a brief disconnect) sees a gap in revision numbers and fetches the missing operations from the log.

```quiz
routing-to-a-websocket
sync-on-reconnect
```

### Presence is ephemeral

Cursors, selections and "who is here" are presence: they change constantly (twice as often as the text here) and are worthless a second later. Send them over the same bus, never through the log, which they would double and bury in noise.

Clients throttle cursor updates to a few a second, and a reconnecting client just waits for the next update. Who is in the document is often kept with a heartbeat and a short expiry, so a closed laptop disappears on its own.

### Snapshots and compaction

A document edited for a year has hundreds of thousands of operations. Replaying them on open means megabytes per open: at 500 opens a second, a gigabyte a second from the log. So every hundred or so operations, a snapshotter folds them into a new full copy in object storage.

Opening reads the latest snapshot and the short tail after it: about 50 KB and a few dozen rows. The log can then be trimmed or archived behind the snapshot, keeping only what version history needs.

## Designing it step by step

**1. Clarify.** Open documents and collaborators each (about two others), how fast others see edits (well under a second), what "saved" means (durable), and whether offline editing is in scope (no: that pushes towards CRDTs).

**2. Connections.** Browsers hold a WebSocket to a session server, through a load balancer. Session servers are stateless apart from their connections.

**3. Edit path.** Session server → the document's collab instance (routed by document id) → transform, assign revision → append to the operation log → ack back to the editor. Then publish on the document's subject; subscribed session servers deliver to collaborators.

**4. Cursors.** Session server → bus → subscribed session servers → collaborators. No collab service, no log.

**5. Open and snapshot.** Docs API reads the latest snapshot from object storage, then the operations after it from the log. A snapshotter reads operations and writes new snapshots.

**6. Size it.** Session servers for 36k messages a second with one lost, a few collab instances for 4k operations, a replicated log, a bus, two of everything else; add up the bill.

**7. Wrap up.** Owner failover with leases, reconnect and resend of pending operations, version history, comments and suggestions as their own operations, and access control on every subscription.

## Common mistakes

**Acknowledging before the log** (`wrong/ack-before-log`). The ack comes a few milliseconds sooner, and a crash in that window loses text users saw as saved. It fails *An edit is in the operation log before it is acknowledged* and `Edit is durable`.

**Waiting for the broadcast** (`wrong/broadcast-before-ack`). The ack waits until every collaborator has the operation, so everyone types at the speed of the slowest browser. It fails *Collaborators get an edit after it is stored, through pub/sub*, and in the model Edit's p99 rises past 100 ms as well.

**Delivering only from the editor's session server** (`wrong/same-server-delivery`). It works in a demo with one server. With 26 servers, almost every collaborator is connected elsewhere and never sees the edit. It fails the pub/sub test.

**Storing cursors** (`wrong/cursors-in-the-log`). Every cursor move becomes a sequenced, stored operation: twice the writes, a collab tier that saturates, and a log full of noise. It fails *Cursor moves are broadcast, never stored*, both p99 limits and `survive any node failure`.

**Replaying the whole log** (`wrong/replay-whole-log`). Without snapshots, every open reads megabytes of operations, saturating the log's and the API's bandwidth. It fails the snapshot test and the p99 of Open document, and drags Edit down with it.

**Others.** Sending whole documents, which makes the last save win; letting any server apply any operation, which needs a distributed lock per keystroke; and forgetting that a reconnecting client must resend its unacknowledged operations.

## In the interview

```callout interview Start from the user's two expectations
"My typing appears instantly and is never lost; other people's typing appears within a moment and we all end up with the same text." Then map them to the design: local apply plus an ack after a durable append; one sequencer per document with OT; pub/sub fan-out after the ack.
```

Likely follow-ups:

- *OT or CRDT?* OT with a central server is simpler and lighter; CRDTs win for offline and peer-to-peer. Either way you need a log, snapshots and fan-out.
- *The collab instance owning a document dies?* A lease expires, another instance takes the document, reloads it from snapshot plus log, and clients resend pending operations.
- *A document with 200 people in it?* Fan-out grows with collaborators: batch operations per tick, throttle cursors harder, and show presence only for those in view.
- *Version history?* It is the log: keep it (or periodic snapshots) and render any revision.
- *How do you keep a client from editing a document it may only view?* Check permissions when the session subscribes and on every operation; the collab service rejects operations from viewers.

## Further reading

- [What's different about the new Google Docs: Making collaboration fast](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html), Google Drive Blog, 2010: why Google Docs moved to operational transformation, and how a server orders operations.
- [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), Figma, 2019: one server process per document, why not OT, and CRDT-inspired properties.
- [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation), Wikipedia: the transformation functions, consistency models and the systems that use them.
- [Conflict-free Replicated Data Types](https://crdt.tech/), crdt.tech: papers, libraries (Yjs, Automerge) and talks on CRDTs.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): queues and back pressure behind the broadcast.
- *Designing Data-Intensive Applications* (Martin Kleppmann), chapter 5 "Replication", section "Handling Write Conflicts", on collaborative editing as multi-leader replication.
