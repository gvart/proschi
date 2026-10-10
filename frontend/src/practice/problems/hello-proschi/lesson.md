```tldr
A design is **nodes**, **connections** and **use cases** (one request walked step by step, with its response). The given **traffic**, **requirements** and **tests** find your use case by its **exact name**. One copy of anything is a single point of failure: **`x2`** clears 99.9%.
```

## What you'll learn

- How a Proschi file describes a system: **nodes** for the parts, **connections** for who may talk to whom.
- How a **use case** walks one request through those parts, step by step, and how every request gets its **response**.
- How the **traffic** block says how often each use case happens, and why your names must match it exactly.
- How **requirements** and **tests** turn "is this design good?" into checks that pass or fail.
- Why one copy of anything is a single point of failure, and how a **replica** (`x2`) fixes an availability requirement.

Every other practice problem uses these six ideas. Here each one gets its own test, so you can add one idea at a time and watch the tests turn green.

## The problem, explained

A user asks for a greeting and gets one back; behind the scenes, a small API reads the text from a database and answers. One actor, one service, one store, one request.

Interview systems are bigger, but built from exactly these pieces. A URL shortener is this design with a cache in the middle; a news feed is this design with a queue and a lot of fan-out. Write the small version fluently and the big ones are about ideas, not syntax.

You do not write everything yourself. Your file starts with `import "problem.proschi"`, which pulls in a read-only given file declaring the `user` (the actor who sends requests), the traffic, the requirements and the tests; open *Given* under the statement to read it. Your job is the part in between: the service, the database, how they connect, and what happens on a request.

## Back-of-the-envelope

```numbers
200 rps | requests, from the traffic block
10% | busy, for one API replica
≈ 99.45% | one API × one database
99.9% | the availability target
≈ 99.997% | with two of each
```

| Quantity | Value | Where it comes from |
|---|---|---|
| Requests | 200 a second | the traffic block |
| One API replica | about 2,000 requests a second | the simulation's default for a REST API |
| API load with one replica | 200 ÷ 2,000 = 10% busy | |
| One database replica (reads) | about 20,000 a second | the default for PostgreSQL |
| Availability of one API replica | 99.5% | the default for a service |
| Availability of one database replica | 99.95% | the default for PostgreSQL |

Load is not the problem; availability is. A request needs the API and the database up at once, so multiply: 99.5% × 99.95% ≈ **99.45%**, against a target of 99.9%. Over the roughly 720 hours of a month, that is about four hours down, against 43 minutes allowed.

With two replicas, a part is down only when both are: for the API 0.5% × 0.5% = 0.0025% of the time (99.9975% available), and the database pair is better still. The request comes out near 99.997%, comfortably above the target: the last step of this problem.

```callout takeaway
Count availability along the path of a request: parts in a row multiply, so every part on the path must be better than the target.
```

```quiz
three-nines-downtime
```

## Concepts

### Nodes

A node is one part of the system, on one line: an id, a name in quotes, and a tech in square brackets.

```proschi fragment
weather "Weather API"   [REST API]
station "Station Store" [MySQL]
```

The **id** (`weather`) is how the rest of the file refers to the node: letters, digits and `_`. The **name** is what the diagram shows. The **tech** decides what the node is: `[REST API]` is a service, `[MySQL]` and `[PostgreSQL]` are databases, `[Redis]` is a cache.

```deepdive What else the tech and the line decide
The tech also sets the node's default numbers in the simulation: how many requests a second it takes, how long a call lasts, how often it is down and what it costs. An optional second string after the name is a description, shown when you hover the node.
```

### Connections

A connection says that one node may call another: an arrow from the caller to the callee, with an optional label.

```proschi fragment
weather -> station : SQL
```

Connections are the lines an interviewer expects on the whiteboard. A use case step between two unconnected nodes still works, but the editor warns you: a request travelling along a wire nobody drew is usually a design mistake.

### Use cases: requests and responses

A use case is one thing a user can do, written as the requests it makes, in order. Each step is an arrow with a label:

```proschi fragment
usecase "Get forecast" {
  visitor  -> weather  : GET /forecast
  weather  -> station  : SELECT readings
  station --> weather  : rows
  weather --> visitor  : 200 forecast
}
```

- `a -> b : …` is a request from `a` to `b`, and `a` waits for the answer.
- `b --> a : …` is the response to the latest request from `a` to `b`. A status at the start of the label, like `200` or `404`, is the HTTP status.

Order matters: the weather API answers the visitor *after* reading the station store, because it needs those readings. The simulation measures latency along these steps, and the tests read them to check what calls what, in which order. Press play under the diagram to watch a use case run.

```callout pitfall
Every `->` from the user needs a matching `-->` back. A request that never gets its response has no status to check and no end to measure.
```

### Traffic

The traffic block, in the given file, says how often each use case happens:

```proschi fragment
traffic {
  "Get forecast" 500 rps
}
```

`rps` is requests per second; `rpm` and `rpd` work too. The simulation sends that load through the use case with that **exact name**, and each node's load comes from the steps that reach it. A use case named anything else gets no traffic, and the requirements and tests that name it cannot find it. Copy names from the given file rather than retyping them.

### Requirements and tests

Requirements are the numbers the design must meet, measured by the simulation under the traffic:

```proschi fragment
requirements {
  p99 "Get forecast" < 200ms
  availability "Get forecast" >= 99.9%
}
```

`p99 < 200ms` means 99 requests out of 100 finish within 200 ms. `availability >= 99.9%` compares the use case's computed availability (every node it touches, as in the arithmetic above) with the target.

Tests check how the design works rather than how fast it is. Each `test` block holds assertions, and every one must hold:

```proschi fragment
test "Forecasts come from the store" {
  "Get forecast" calls any database
  "Get forecast" responds 200
}
```

`any database` is a selector matching every node whose tech is a database, MySQL or PostgreSQL alike. Each test shows what it measured and, when it fails, a hint: reading a failing test is the fastest way to learn what it wants.

### Replicas and availability

Every machine fails sometimes (a dead disk, a bad deploy, a replaced host). A node with one replica is a **single point of failure**: when it is down, every request that needs it fails. Write `x2` at the end of a node's line to run two replicas:

```proschi fragment
weather "Weather API" [REST API] x2
```

Two service replicas share the name and the load, and one answers when the other is down; two database replicas are a primary and a standby that takes over. Replicas cost money too (two API replicas cost twice one), which is why bigger problems have a budget: add replicas where they buy something, not everywhere by habit.

```quiz
availability-in-series
```

## Designing it step by step

### Step 1: The service

The starter already has one node, the API. Add the database next to it: an id, a name and a database tech. Run the tests: most still fail, but the editor has no complaints and the diagram shows two boxes and the user.

### Step 2: The wires

Connect the user to the API and the API to the database. No test passes yet: tests look at use cases, and there is none.

### Step 3: The use case

Write `usecase "Say hello"` with four steps: the user's request to the API, the API's request to the database, the database's answer, and the API's answer to the user with a `200`. Check the name against the traffic block. Now *A service answers the user*, *Say hello answers with 200*, *The greeting is read from a database* and the p99 requirement pass.

### Step 4: The spare

Two checks are still red: the availability requirement and *Every component has a spare*. The availability one shows the computed number, well under 99.9%. Add `x2` to both nodes and everything passes. Then compare with the reference solution: its `decision` block records why the design is the way it is, a habit worth keeping in every problem.

## Common mistakes

**One replica of everything** (`wrong/one-of-everything`). Right in every other way, and the first thing almost everyone writes. Each node is a single point of failure, and the request's availability is the product of both nodes': about 99.45%. It fails the availability requirement and *Every component has a spare*.

**A request without its response** (`wrong/no-response`). The use case sends `GET /hello`, reads the database and stops. Nothing answers the user, so there is no status to check and no end to the request. It fails *Say hello answers with 200*. Every `->` from the user needs a matching `-->` back.

**No database** (`wrong/no-database`). The API answers from memory: simple, but the greeting is lost on every restart, two replicas would each hold their own copy, and changing the greeting means a deploy. It fails *The greeting is read from a database*.

**A use case name that does not match** (`wrong/use-case-name-mismatch`). The flow is perfect but the use case is called `"Hello"`. The traffic, requirements and tests all name `"Say hello"`, so none finds it: the flow tests fail, and the requirements have no traffic to measure. The clue is the warnings under the tests about names in `problem.proschi` that match no use case.

## In the interview

Nobody asks for a greeting service, but interviewers watch for the habits it trains:

- **Start with the request path.** Draw the client, the first service and the store, and walk one request through them before adding anything else. A use case is exactly that walk.
- **Say where the data lives.** "The API reads it from PostgreSQL" is a design; "the API has it" is not.
- **Name the single points of failure** before you are asked, and say what a second replica buys and costs.
- **Do the availability arithmetic** out loud: parts in a row multiply, replicas in parallel multiply their downtime.

```callout interview
Walk one request end to end first: where it goes, where the data lives, what happens when one box dies.
```

## Further reading

- [Proschi language reference](https://proschi.app/docs/language/): every statement, step arrow, requirement and test assertion.
- [Quick start](https://proschi.app/docs/quickstart/): writing and running a design in the editor.
- [How the simulation works](https://proschi.app/docs/model/): the default numbers per tech and how latency and availability are computed.
- [System Design Primer: availability in numbers](https://github.com/donnemartin/system-design-primer#availability-in-numbers): downtime per year and month for each number of nines, and availability in sequence and in parallel.
