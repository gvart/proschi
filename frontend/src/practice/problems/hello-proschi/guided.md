## A service that answers the user
- node: any service

The starter already has the first piece: a `Greeting API` (a `[REST API]`
service). A node is one line: an id, a name in quotes and a tech in square
brackets. The `user` comes from `problem.proschi`; open *Given* to see it.
Press **Check** to confirm and unlock the next step.

## Connect the user
- edge: user -> any service

A connection says who may call whom. Draw the wire from the user to the
API: `user -> api : HTTPS`. The diagram now shows the line between them.

## Say hello answers with 200
- usecase: Say hello
- test: A service answers the user
- test: Say hello answers with 200

Write `usecase "Say hello" { … }`, named exactly as in the traffic block.
The user sends a request (`user -> api : GET /hello`) and the API answers
it (`api --> user : 200 Hello`). Every `->` from the user needs its `-->`
back, and the `200` at the start of the label is the status.

## Read the greeting from a database
- node: any database
- edge: any service -> any database
- test: The greeting is read from a database
- test: p99 of Say hello < 100 ms

A greeting that lives only in the API's memory is lost on every restart.
Add a database (`db "Greetings DB" [PostgreSQL]`), connect the API to it
(`api -> db : SQL`), and in **Say hello** read it before answering:
`api -> db : SELECT greeting`, then `db --> api : "Hello"`, then the API's
`200` to the user.

## Every component has a spare
- replicas: any service x2
- replicas: any database x2
- test: Every component has a spare
- test: availability of Say hello ≥ 99.9%

One replica of anything is a single point of failure, and both nodes are
on every request: 99.5% × 99.95% ≈ 99.45%, under the 99.9% target. Write
`x2` at the end of both nodes' lines. Then press **Run tests**: everything
should pass.
