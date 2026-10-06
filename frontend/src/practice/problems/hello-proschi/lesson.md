## What you'll learn

- How a Proschi file describes a system: **nodes** for the parts, **connections** for who may talk to whom.
- How a **use case** walks one request through those parts, step by step, and how every request gets its **response**.
- How the **traffic** block says how often each use case happens, and why your names must match it exactly.
- How **requirements** and **tests** turn "is this design good?" into checks that pass or fail.
- Why one copy of anything is a single point of failure, and how a **replica** (`x2`) fixes an availability requirement.

Every other practice problem uses these six ideas. Here each one gets its own test, so you can add one idea at a time and watch the tests turn green.

## The problem, explained

A user asks for a greeting and gets one back. Behind the scenes, a small API reads the greeting text from a database and answers. That is the whole system: one actor, one service, one store, one request.

Real interviews ask for much bigger systems, but they are built from exactly these pieces. A URL shortener is this design with a cache in the middle; a news feed is this design with a queue and a lot of fan-out. Learning to write the small version fluently means the big ones are about ideas, not syntax.

You do not write everything yourself. The problem gives you a read-only file, `problem.proschi`, and your file starts with `import "problem.proschi"`, which pulls it in. The given file declares the `user` (the actor who sends requests), the traffic, the requirements and the tests. Open *Given* under the statement to read it. Your job is the part in between: the service, the database, how they connect, and what happens on a request.

## Back-of-the-envelope

The numbers here are small, which makes them a good place to learn how to read them.

| Quantity | Value | Where it comes from |
|---|---|---|
| Requests | 200 a second | the traffic block |
| One API replica | about 2,000 requests a second | the simulation's default for a REST API |
| API load with one replica | 200 ÷ 2,000 = 10% busy | |
| One database replica (reads) | about 20,000 a second | the default for PostgreSQL |
| Availability of one API replica | 99.5% | the default for a service |
| Availability of one database replica | 99.95% | the default for PostgreSQL |

Load is not the problem: one replica of each part is barely busy. The problem is availability. A request needs both the API and the database, so both must be up at once. Multiply: 99.5% × 99.95% ≈ **99.45%**. The target is 99.9%. A month has about 720 hours, so 99.45% is about four hours down a month, against 43 minutes allowed.

With two replicas, the service is down only when both are down at once. For the API that is 0.5% × 0.5% = 0.0025% of the time, so 99.9975% available; the database pair is better still. The whole request comes out near 99.997%, comfortably above the target. That is the last step of this problem.

> Count availability along the path of a request: parts in a row multiply, so every part on the path must be better than the target.

## Concepts

### Nodes

A node is one part of the system. You write it on one line: an id, a name in quotes, and a tech in square brackets.

```proschi fragment
weather "Weather API"   [REST API]
station "Station Store" [MySQL]
```

The **id** (`weather`) is how the rest of the file refers to the node: letters, digits and `_`. The **name** is what the diagram shows. The **tech** decides what the node is: `[REST API]` is a service, `[MySQL]` and `[PostgreSQL]` are databases, `[Redis]` is a cache. The tech also sets the node's default numbers in the simulation: how many requests a second it takes, how long a call lasts, how often it is down and what it costs. An optional second string is a description, shown when you hover the node.

### Connections

A connection says that one node may call another. It is an arrow from the caller to the callee, with an optional label:

```proschi fragment
weather -> station : SQL
```

Connections are the architecture: the boxes and lines an interviewer expects on the whiteboard. A step in a use case between two nodes that are not connected still works, but the editor warns you, because a request travelling along a wire nobody drew is usually a mistake in the design.

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

Every request should get its response, and the order matters: the weather API answers the visitor *after* it has read the station store, because it needs those readings to answer. The simulation measures latency along these steps, and the tests read them to check what calls what, and in which order. Press play under the diagram to watch a use case run.

### Traffic

The traffic block, in the given file, says how often each use case happens:

```proschi fragment
traffic {
  "Get forecast" 500 rps
}
```

`rps` is requests per second; `rpm` and `rpd` work too. The simulation sends that load through the steps of the use case with that **exact name**, and each node's load comes from the steps that reach it. A use case named anything else gets no traffic at all, and the requirements and tests that name the use case cannot find it. Copy names from the given file rather than retyping them.

### Requirements and tests

Requirements are the numbers the design must meet, measured by the simulation under the traffic:

```proschi fragment
requirements {
  p99 "Get forecast" < 200ms
  availability "Get forecast" >= 99.9%
}
```

`p99 < 200ms` means 99 requests out of 100 finish within 200 ms. `availability >= 99.9%` compares the computed availability of the use case (every node it touches, as in the arithmetic above) with the target.

Tests check how the design works rather than how fast it is. Each `test` block holds assertions, and every one must hold:

```proschi fragment
test "Forecasts come from the store" {
  "Get forecast" calls any database
  "Get forecast" responds 200
}
```

`any database` is a selector: it matches every node whose tech is a database, so the test does not care whether you picked MySQL or PostgreSQL. Run the tests and each one shows what it measured and, when it fails, a hint. Reading a failing test is the fastest way to learn what it wants.

### Replicas and availability

Every machine fails sometimes: a disk dies, a deploy goes wrong, a host is replaced. A node with one replica is a **single point of failure**: when it is down, every request that needs it fails. Write `x2` at the end of a node's line to run two replicas:

```proschi fragment
weather "Weather API" [REST API] x2
```

Two replicas of a service sit behind the same name and share the load; when one is down, the other answers. Two replicas of a database are a primary and a standby that takes over. A replica also costs money: two API replicas cost twice as much as one, which is why the bigger problems have a budget and you add replicas where they buy something, not everywhere by habit.

## Designing it step by step

### Step 1: The service

The starter already has one node, the API. Add the database next to it: an id, a name and a database tech. Run the tests. Most still fail, but the editor has nothing to complain about, and the diagram shows two boxes and the user.

### Step 2: The wires

Connect the user to the API and the API to the database. The diagram now has its lines. No test passes yet: tests look at use cases, and there is none.

### Step 3: The use case

Write `usecase "Say hello"` with four steps: the user's request to the API, the API's request to the database, the database's answer, and the API's answer to the user with a `200`. Check the name against the traffic block. Run the tests: *A service answers the user*, *Say hello answers with 200* and *The greeting is read from a database* pass, and the p99 requirement too.

### Step 4: The spare

Two checks are still red: the availability requirement and *Every component has a spare*. Read the availability one: it shows the computed number, well under 99.9%. Add `x2` to both nodes, run again, and everything passes. Then compare with the reference solution: it also has a `decision` block, which records why the design is the way it is, a habit worth keeping in every problem.

## Common mistakes

**One replica of everything** (`wrong/one-of-everything`). The design is right in every other way, and it is the first thing almost everyone writes. Each node is a single point of failure, and the availability of the request is the product of both nodes': about 99.45%. It fails the availability requirement and *Every component has a spare*.

**A request without its response** (`wrong/no-response`). The use case sends `GET /hello`, reads the database and stops. Nothing answers the user, so there is no status to check and no end to the request. It fails *Say hello answers with 200*. Every `->` from the user needs a matching `-->` back.

**No database** (`wrong/no-database`). The API answers from memory. It is fast and simple, and the greeting is lost on every restart; two replicas would each hold their own copy, and changing the greeting means a deploy. It fails *The greeting is read from a database*.

**A use case name that does not match** (`wrong/use-case-name-mismatch`). The flow is perfect but the use case is called `"Hello"`. The traffic, requirements and tests all name `"Say hello"`, so none of them finds it: the tests about the flow fail, and the requirements have no traffic to measure. The warnings under the tests, about names in `problem.proschi` that match no use case, are the clue.

## In the interview

Interviewers rarely ask about a greeting service, but they always watch for the habits it trains:

- **Start with the request path.** Draw the client, the first service and the store, and walk one request through them before adding anything else. A use case is exactly that walk.
- **Say where the data lives.** "The API reads it from PostgreSQL" is a design; "the API has it" is not.
- **Name the single points of failure** before you are asked, and say what a second replica buys and costs.
- **Do the availability arithmetic** out loud: parts in a row multiply, replicas in parallel multiply their downtime.

## Further reading

- [Proschi language reference](https://proschi.app/docs/language/): every statement, step arrow, requirement and test assertion.
- [Quick start](https://proschi.app/docs/quickstart/): writing and running a design in the editor.
- [How the simulation works](https://proschi.app/docs/model/): the default numbers per tech and how latency and availability are computed.
- [System Design Primer: availability in numbers](https://github.com/donnemartin/system-design-primer#availability-in-numbers): downtime per year and month for each number of nines, and availability in sequence and in parallel.
