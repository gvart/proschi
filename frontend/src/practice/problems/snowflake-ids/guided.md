## Start from the generator
- node: idgen
- usecase: Get ID

The starter gives you an `ID Generator` that the Tweet Service calls for
every new id, and a **Get ID** use case that answers straight from the
generator. That is already the key idea: no database, no cache, no shared
counter on the path. Press **Check** to go on.

## Claim a worker id at startup
- edge: idgen -> zk
- usecase: Start generator
- test: Each generator claims its worker id once, at startup

Two generators must never hand out the same id, so each one needs a worker
id no other running generator has. ZooKeeper (`zk`, already given) can hand
those out: connect the generator to it (`idgen -> zk`) and add
`usecase "Start generator"` in which the generator writes to ZooKeeper
(`CREATE /snowflake/workers/ ephemeral sequential`) and gets its worker id
back. **Get ID** must still never call `zk`: coordination happens once per
process, not once per id.

## Enough generators for the load and failures
- replicas: idgen x2
- test: survive any node failure
- test: p99 of Get ID < 40 ms
- test: availability of Get ID ≥ 99.99%

20k ids a second at 99.99% availability: one generator is a single point of
failure and too slow at that rate. Add replicas (`x2` at the very least,
then more until the p99 is under 40 ms; the *Analysis* tab shows how busy
each replica is). Each replica claims its own worker id at startup, so they
never collide. Then run the tests.
