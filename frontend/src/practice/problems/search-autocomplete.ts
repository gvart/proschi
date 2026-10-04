import type { Problem } from '../types';

export const searchAutocomplete: Problem = {
  id: 'search-autocomplete',
  title: 'Search Autocomplete',
  difficulty: 'medium',
  tags: ['caching', 'cdn', 'read-heavy', 'batch'],
  statement: `A shop's search box should suggest completions while the user
types: after \`ipho\` it shows *iphone 15*, *iphone case*, *iphone charger*.
Every keystroke is a request, so suggestions are read far more often than
anything else and must feel instant. The ten best completions of a prefix are
the ones searched most often recently; they change slowly, so they can be
computed ahead of time.

## Functional requirements

- **Suggest**: the search box sends \`GET /suggest?q=<prefix>\` and gets the
  top ten completions of the prefix. Model it with two scenarios:
  - \`"Edge hit"\`: the prefix is popular and the CDN answers from its cache
    (suggestions may be up to 5 minutes old).
  - \`"Edge miss"\`: the CDN passes the request on and the top ten are read
    from the precomputed suggestion index, kept in memory.
- **Search**: the user submits a query and gets results from the search
  cluster. Every query is appended to a query log for the index to learn from.
- **Rebuild index**: every 15 minutes the scheduler starts a rebuild, which
  reads the recent queries from the query log, counts them per prefix and
  writes the new top ten of every prefix into the suggestion index.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- Suggestions: **100k rps** at peak; 80% of them are for popular prefixes
  the CDN can cache.
- Searches: **2k rps**.
- About 5 million distinct prefixes with ten completions each: a few GB, small
  enough to keep in memory.

## Constraints

- p99 of a suggestion under **100 ms**; of a search under **300 ms**.
- Suggestions available **99.95%** of the time.
- The search cluster is sized for searches only (about 9k rps); suggestions
  must never reach it, nor any database.
- Losing any single machine must not take either use case down.
- At most **$5,500 / month**, the search cluster and the scheduler included.

## What is given

\`problem.proschi\` declares the \`user\`, the existing search cluster
\`search\` (three Elasticsearch nodes) and the \`scheduler\` that starts the
rebuild, and holds the traffic, requirements and tests. Add the suggestion
path, the query log, the index builder, the connections and the three use
cases.`,
  given: `title "Search Autocomplete" "Suggests completions while the user types, from an index rebuilt from past queries"

user      "User"           [Actor]
search    "Search Cluster" [Elasticsearch]   x3 @search "Full-text search over the catalogue, sized for searches"
scheduler "Scheduler"      [AWS EventBridge]    @search "Starts an index rebuild every 15 minutes"

traffic {
  "Suggest" 100k rps mix "Edge hit" 80%, "Edge miss" 20%
  "Search"  2k rps
}

requirements {
  p99 "Suggest" < 100ms
  p99 "Search" < 300ms
  availability "Suggest" >= 99.95%
  survive any node failure
  cost <= 5500 usd/month
}

test "Suggestions never touch the search cluster" {
  "Suggest" never calls search
  "Suggest" never calls any database
}

test "Suggestions are served from caches" {
  "Suggest" has scenario "Edge hit"
  "Suggest" has scenario "Edge miss"
  "Suggest" scenario "Edge hit" never calls any service
  "Suggest" scenario "Edge miss" calls any cache
}

test "Searches feed the query log" {
  "Search" calls search
  "Search" calls any queue
  "Search" responds 200
}

test "The index is rebuilt offline from the query log" {
  "Rebuild index" calls any queue before any cache
  "Rebuild index" never calls search
}
`,
  starter: `import "problem.proschi"

# Add the suggestion path, the query log, the index builder and the use cases
# "Suggest", "Search" and "Rebuild index".
api "Search API" [REST API]

user -> api
api  -> search

usecase "Suggest" {
  user    -> api    : GET /suggest?q=ipho
  api     -> search : prefix query "ipho*"
  search --> api    : hits
  api    --> user   : 200 ["iphone 15", "iphone case"]
}
`,
  solution: `import "problem.proschi"

cdn      "CDN"              [AWS CloudFront]    x3 @search "Caches the suggestions of popular prefixes for 5 minutes"
lb       "Load Balancer"    [AWS Load Balancer] x2
suggest  "Suggest Service"  [REST API]          x20 @search "Looks up the top ten completions of a prefix"
topk     "Suggestion Index" [Redis]             x2 @search "Top ten completions per prefix, replaced by every rebuild"
api      "Search API"       [REST API]          x3 @search "Runs searches and logs every query"
querylog "Query Log"        [Kafka]             x2 @search "Every search query, kept for 7 days"
builder  "Index Builder"    [AWS Fargate]       x2 @search "Counts queries per prefix and writes the new top ten"

user      -> cdn      : HTTPS
user      -> lb       : HTTPS
cdn       -> lb       : origin
lb        -> suggest  : HTTP
lb        -> api      : HTTP
suggest   -> topk     : GET
api       -> search   : query
api       -> querylog : produce
scheduler -> builder  : RebuildIndex
builder   -> querylog : consume
builder   -> topk     : SET

entity Suggestions in topk "The ten most searched completions of one prefix" {
  prefix      string key
  completions json
  builtAt     time
}

entity Query in querylog "One submitted search" {
  text     string
  userId   uuid optional
  searched time
}

decision "Precompute the top ten per prefix" {
  because "A Redis GET takes ~1 ms; a prefix query on Elasticsearch takes ~15 ms and the cluster handles 9k rps, a tenth of the keystrokes"
  rejected "Prefix queries on the search cluster" "Would need 40+ Elasticsearch nodes and still miss the p99"
}
decision "Cache popular prefixes at the CDN" {
  because "80% of keystrokes hit a few thousand popular prefixes; serving them at the edge cuts the Suggest Service from ~80 to 20 replicas"
  rejected "No edge cache" "Every keystroke reaches your servers; the budget does not allow it"
}
decision "Rebuild every 15 minutes from the query log" because "Rankings change slowly; a batch over the log keeps all the counting off the request path"

usecase "Suggest" "Top ten completions of what the user has typed so far" {
  user -> cdn : GET /suggest?q=ipho

  alt "Edge hit" when "the prefix was asked for in the last 5 minutes" {
    cdn --> user : 200 ["iphone 15", "iphone case", "iphone charger"]
  } alt "Edge miss" when "the CDN has no fresh copy" {
    cdn      -> lb      : GET /suggest?q=ipho
    lb       -> suggest : GET /suggest?q=ipho
    suggest  -> topk    : GET top10:ipho
    topk    --> suggest : ["iphone 15", "iphone case", "iphone charger"]
    suggest --> lb      : 200 Cache-Control max-age=300
    lb      --> cdn     : 200
    cdn     --> user    : 200 ["iphone 15", "iphone case", "iphone charger"]
  }
}

usecase "Search" "Run a submitted query and log it" {
  user    -> lb       : GET /search?q=iphone+case
  lb      -> api      : GET /search?q=iphone+case
  api     -> search   : match "iphone case"
  search --> api      : hits
  api    ->> querylog : Query "iphone case"
  api    --> lb       : 200 {"results": []}
  lb     --> user     : 200 {"results": []}
}

usecase "Rebuild index" "Recompute the top ten of every prefix from recent queries" {
  scheduler ->> builder  : RebuildIndex
  builder    -> querylog : read the last 7 days
  querylog  --> builder  : queries
  builder    -> topk     : SET top10:{prefix} for changed prefixes
  topk      --> builder  : OK
}
`,
  hints: [
    'The search cluster handles 9k rps and suggestions come at 100k rps. What could answer a prefix without searching at all?',
    'The top ten of a prefix changes slowly: compute it ahead of time from the query log and keep it in an in-memory store keyed by prefix.',
    'Most keystrokes are for a few popular prefixes. A CDN can answer those for a few minutes without reaching your servers, which is what makes the budget work.',
    'Size the Suggest Service for the edge misses only (20k rps) and keep it near 50% busy: its queueing delay decides the p99.',
  ],
};
