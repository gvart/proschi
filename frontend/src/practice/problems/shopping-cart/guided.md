## Start from the cart service
- node: any service
- usecase: Add to cart

The starter has a `Cart Service` the `shopper` calls, and a first
**Add to cart** that answers `200` without storing anything. Look at it in
the editor and the diagram, then press **Check**.

## Store adds in an always-writable store
- node: any database
- edge: any service -> any database
- test: Adds go to an eventually consistent store that is always writable

The add must survive the cart service restarting, so it is written to a
database before the `200`. Which database matters: a strongly consistent
store (PostgreSQL, a single-primary setup) refuses writes while its primary
fails over, and adds must never be rejected. Pick a leaderless, eventually
consistent store such as DynamoDB (`carts "Carts" [DynamoDB]`) and write the
cart there (`cart -> carts : PutItem Cart`) before answering.

## View the cart and merge divergent versions
- usecase: View cart
- test: Divergent versions are merged and written back

Add `usecase "View cart"` with the scenarios `"One version"` and
`"Divergent versions"`. When two writes raced, the store hands back several
versions; the service merges them (the union of the items, so no add is
lost) and writes the merged cart back before answering.

## Replicate for five nines
- replicas: any service x2
- replicas: any database x3
- test: availability of Add to cart ≥ 99.999%
- test: survive any node failure

99.999% is about five minutes of downtime a year. One copy of anything
cannot promise that: write `x2` or more on the service (a load balancer in
front spreads shoppers over the replicas) and keep the carts on three
replicas (`x3`), so any of them can take a write while another is down.
Then run the tests.
