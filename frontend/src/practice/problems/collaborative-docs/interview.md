## Questions

### How many edits and cursor moves a second?
- kind: good
- fact: Edit: 4k rps and Move cursor: 8k rps at peak

**4k edits and 8k cursor moves a second** at peak, across about a million open documents. An edit is a batch of a few hundred milliseconds of typing.

### How many people see each edit, and where are they connected?
- kind: good
- fact: Each edit and each cursor move goes to 2 collaborators on average

**2 collaborators** on average, and they are almost never on the same session server as the editor or each other.

### What does "saved" mean?
- kind: good
- fact: an operation is in a durable log before its editor is told it is saved

The ack is a promise: **the operation is in a durable log before the editor is told it is saved**.

### Do collaborators have to receive an edit before the editor gets the ack?
- kind: good
- fact: Collaborators receive an operation only after it is stored, and the editor never waits for their deliveries

No: collaborators get it **only after it is stored**, and **the editor never waits** for them.

### Should cursor positions be kept?
- kind: good
- fact: Cursor moves are broadcast but never stored

No: **broadcast, never stored**.

### How fast must it be?
- kind: good
- fact: p99 of Edit under 100 ms, of Move cursor under 60 ms

p99 of an edit **under 100 ms**, of a cursor move **under 60 ms**, of opening a document under 400 ms.

### How often are documents opened, and how big are they?
- kind: good
- fact: Open document: 500 rps; a document's snapshot is about 50 KB

**500 opens a second**, and a snapshot is about **50 KB**.

### Which rich-text editor component should the front end use?
- kind: weak

A client detail; ask how many people edit a document at once and what "saved" must mean.

### Should we support dark mode?
- kind: weak

Not an architecture question; ask about edit rates and latency targets instead.

### Do we need to support images and tables?
- kind: weak

They are just more operation types for the same pipeline; ask about the rates and the durability promise, which shape the design.

## Estimates

### How many messages a second pass through the session servers?
- answer: 36k
- unit: messages/s
- range: 30k to 42k

12k incoming (4k edits + 8k cursors), each delivered to 2 collaborators: 24k outgoing. Together **36k messages a second**.

### How many operations are appended to the log in a day?
- answer: 350M
- unit: operations
- range: 300M to 400M

4,000 × 86,400 ≈ **350 million operations a day**, about 70 GB at 200 bytes each.

### How many megabytes a second would opening documents read if every open replayed about 2 MB of history?
- answer: 1000
- unit: MB/s
- range: 800 to 1200

500 opens × 2 MB = **1 GB a second**, against 25 MB/s with 50 KB snapshots.

Numbers: [Numbers to know](../docs/numbers/).
