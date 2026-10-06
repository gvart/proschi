---
title: Hello, Proschi
summary: Your first design, step by step - nodes, connections, a use case, traffic, requirements and a spare.
difficulty: easy
tags: [basics, proschi, availability]
order: 1
hints:
  - "A node is an id, a name and a tech: db \"Greetings DB\" [PostgreSQL]. Connect two nodes with api -> db."
  - "A use case is a list of steps: user -> api : GET /hello sends a request, api --> user : 200 answers it. Call it exactly \"Say hello\", the name the traffic uses."
  - "Read the greeting in the middle of the use case: api -> db : SELECT greeting, then db --> api : \"Hello\", before the API answers."
  - "If the availability requirement fails, give each node a spare: write x2 at the end of its line."
---

Your first system in Proschi: a tiny greeting service. A user asks for a
greeting, an API reads it from a database and answers. The design is small on
purpose; this problem is about the language. Each test checks one idea, so
you can solve it one step at a time and run the tests after each step.

## Functional requirements

- **Say hello**: the user sends `GET /hello` to a service, which reads the
  greeting from a database and answers `200` with it.

Use the use case name `"Say hello"` exactly: the traffic, requirements and
tests in `problem.proschi` refer to it.

## Scale

- **200 requests a second** to Say hello.

## Constraints

- p99 of Say hello under **100 ms**.
- Say hello available **99.9%** of the time.
- Every component has a spare: two replicas or more.

## What is given

`problem.proschi` declares the `user` and holds the traffic, the
requirements and the tests; open *Given* below to read them. Your file
imports it. Add the service and the database, connect them, and write the
use case:

1. Add a node for the service (the starter has one) and one for the
   database.
2. Connect the user to the service, and the service to the database.
3. Write `usecase "Say hello"`: the request, the database read, the
   response.
4. Run the tests, read what fails, and give each node a spare.
