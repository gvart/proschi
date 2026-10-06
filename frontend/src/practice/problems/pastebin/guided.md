## Start from the API
- node: any service
- usecase: Create paste

The starter gives you a `Paste API` that the `user` talks to and a first
**Create paste** use case. Everything a user does goes through that API (or,
later, through a CDN in front of it). Look at the diagram, then press
**Check**.

## Keep the text in object storage
- node: any storage
- edge: any service -> any storage
- test: Paste text lives in object storage

Pastes are up to 10 MB and add up to about 80 TB: blobs belong in object
storage, not in database rows. Add a bucket
(`bodies "Paste Bodies" [AWS S3]`), connect the API to it, and in
**Create paste** `PUT` the text before the API answers `201`. Put the size
on the steps that carry the text (`~10KB PUT pastes/k7Qz2`).

## Keep metadata in a database
- node: any database
- edge: any service -> any database
- test: Metadata lives in a database

The service also needs to find a paste by id and know when it expires: a
small row per paste in a database (`meta "Paste DB" [PostgreSQL]`). In
**Create paste**, `INSERT` that row too before answering `201`.

## Read pastes and check expiry first
- usecase: Read paste
- test: Expiry is checked before the text is fetched

Add `usecase "Read paste"` with the three scenarios `"Cached"`,
`"Not cached"` and `"Expired"` (use `alt` blocks). The API reads the row
from the database first: an expired paste gets `404` and its text is never
fetched; otherwise the API fetches the text from storage. For now
`"Cached"` can be the same as `"Not cached"`.

## Serve popular pastes from a CDN
- node: any cdn
- test: Popular pastes are served by the CDN
- test: p99 of Read paste scenario Cached < 30 ms

A link shared in a chat is opened by everybody within minutes, and a popular
paste must load in under 30 ms: only an edge close to the reader is that
fast. Put a CDN in front of the API (`cdn "CDN" [AWS CloudFront]`,
`user -> cdn`, `cdn -> api`) and start every use case at it. In `"Cached"`
the CDN answers by itself; the text it sends also costs $0.02/GB instead of
the $0.09/GB the API would pay.

## Two of everything
- replicas: any service x2
- replicas: any database x2
- replicas: any storage x2
- replicas: any cdn x2
- test: survive any node failure

Losing any single machine must not take the service down, so write `x2` (or
more) on every component. Then run the tests: the cost and latency limits
should pass too.
