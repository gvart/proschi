## Start from the API
- node: any service
- usecase: Shorten

The starter already has the first piece: a `Shortener API` (a `[REST API]`
service) that the `visitor` talks to, and the **Shorten** use case. Read it
in the editor and look at the diagram. Every request in this problem enters
through that API, so the rest of the design hangs off it.

Press **Check** to confirm and unlock the next step.

## Store every code in a database
- node: any database
- edge: any service -> any database
- test: Codes are stored before they are returned

A code that only lives in the API's memory is gone when that machine
restarts. Add a database (`db "Links DB" [DynamoDB]`), connect the API to
it (`api -> db : read / write`), and in **Shorten** write the code
(`api -> db : INSERT Url`, then `db --> api : ok`) *before* the API answers
`201`. The order of the steps is the promise: the visitor only gets a code
that is already stored.

## Add the Redirect use case
- usecase: Redirect
- test: Redirects redirect

Now the read side: `usecase "Redirect"`, where the visitor sends
`GET /aZ3x9`, the API looks the code up in the database, and answers
`302 Location`. Give it the two scenarios the statement names with
`alt "Cache hit" { … } alt "Cache miss" { … }`; for now both may read the
database. The next step makes the hit fast.

## Add a cache to meet the p99
- node: any cache
- edge: any service -> any cache
- test: Redirects read the cache first
- test: Misses fill the cache

Redirects outnumber shortening 100 to 1, and 95% of them are for codes
opened recently. Put a cache in front of the database
(`cache "Code Cache" [Redis]`, `api -> cache : GET / SET`). In
**Redirect**, read the cache first: on `"Cache hit"` the cache answers and
the database is never called; on `"Cache miss"` read the database, then
`SET` the code in the cache (`api ->> cache` is fine) so the next visitor
hits.

## Two of everything for availability
- replicas: any service x2
- replicas: any cache x2
- replicas: any database x2
- test: survive any node failure

One machine of anything is a single point of failure: when it dies, the
service is down. Write `x2` (or more) after every component you added, for
example `db "Links DB" [DynamoDB] x2`. A load balancer in front of the API
replicas (`[AWS Load Balancer] x2`) spreads the visitors over them.

## Size it for the load
- test: p99 of Redirect < 50 ms
- test: availability of Redirect ≥ 99.9%
- test: cost ≤ $3,000/month

10k redirects a second is more than two API replicas take: a REST API
handles about 2k rps per replica in the simulation, and it gets slow well
before it is full. Raise the API's replicas until its p99 is under 50 ms
(the *Analysis* tab shows how busy each node is), and keep an eye on the
budget. Then press **Run tests**: everything should pass.
