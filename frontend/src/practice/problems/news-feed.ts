import type { Problem } from '../types';

export const newsFeed: Problem = {
  id: 'news-feed',
  title: 'News Feed',
  difficulty: 'medium',
  tags: ['fan-out', 'queues', 'caching', 'read-heavy'],
  statement: `Design the home timeline of a social network: people publish short
posts, and everyone who follows them sees those posts at the top of their
feed, newest first.

## Functional requirements

- **Publish post**: a user posts up to 500 characters and gets \`201\` with
  the post id. The post must show up in the feeds of all their followers
  within a few seconds.
- **Read feed**: a user opens the app and gets the 50 newest posts of the
  people they follow (\`200\`).

Use these use case names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- 20M daily active users. **Read feed: 10k rps** at peak.
- **Publish post: 500 rps** at peak.
- A user has 200 followers on average, and nobody has more than 5,000
  (accounts with millions of followers are a follow-up, not part of this
  problem). So each post lands in about 200 feeds.
- A feed only needs its newest 500 post ids.

## Constraints

- p99 of reading the feed under **100 ms**, of publishing under **150 ms**.
- Reading the feed available **99.9%** of the time.
- A post is never lost once the user got \`201\`, and no feed ever shows a
  post that was not stored.
- Losing any single machine must not take the service down.
- At most **$4,000 / month**, the social graph included.

## What is given

\`problem.proschi\` declares the \`user\` and the existing \`graph\` service
that knows who follows whom. Listing the followers of an account pages
through up to 5,000 ids and takes about **50 ms**. The file also holds the
traffic, requirements and tests. Add the components, the connections and the
two use cases.`,
  given: `title "News Feed" "Shows each user the newest posts of the people they follow"

user  "User"         [Actor]
graph "Social Graph" [REST API] x4 @social "Who follows whom; already exists"

capacity {
  graph latency 50ms
}

traffic {
  "Read feed"    10k rps
  "Publish post" 500 rps
}

requirements {
  p99 "Read feed" < 100ms
  p99 "Publish post" < 150ms
  availability "Read feed" >= 99.9%
  durable "Publish post"
  survive any node failure
  cost <= 4000 usd/month
}

test "Reading the feed never queries a database" {
  "Read feed" calls any cache
  "Read feed" never calls any database
  "Read feed" never calls graph
}

test "Posts are stored before they reach any feed" {
  "Publish post" calls any database before any cache
  "Publish post" responds 201
}

test "Fan-out runs behind a queue" {
  "Publish post" calls graph
  "Publish post" calls any queue before graph
}
`,
  starter: `import "problem.proschi"

# Add the components, connections and the use cases "Publish post" and "Read feed".
api "Feed API" [REST API]

user -> api

usecase "Read feed" {
  user -> api : GET /feed
  api --> user : 200 {"posts": []}
}
`,
  solution: `import "problem.proschi"

lb        "Load Balancer"  [AWS Load Balancer] x2 @feed
api       "Feed API"       [REST API]          x9 @feed "Publishes posts and serves feeds"
posts     "Posts DB"       [Cassandra]         x2 @feed "Every post, partitioned by author"
events    "Post Events"    [Kafka]             x2 @feed "PostCreated events for the fan-out"
fanout    "Fan-out Worker" [REST API]          x2 @feed "Pushes each new post into its followers' feeds"
feeds     "Feed Cache"     [Redis]             x2 @feed "The newest 500 post ids of every active user"
postCache "Post Cache"     [Redis]             x2 @feed "Recent posts by id, so feeds can be shown without the database"

user   -> lb
lb     -> api       : HTTPS
api    -> posts     : write
api    -> events    : produce
events -> fanout    : consume
fanout -> graph     : followers
fanout -> postCache : SET
fanout -> feeds     : ZADD
api    -> feeds     : ZREVRANGE
api    -> postCache : MGET

entity Post in posts "One post" {
  id        string key
  authorId  string index
  text      string
  createdAt time
}

entity Feed in feeds "A sorted set of post ids per user, newest first, capped at 500" {
  userId string key
  postId string
  score  time
}

entity CachedPost in postCache "A post as the feed shows it" {
  id     string key
  author string
  text   string
}

decision "Fan-out on write" {
  because "Reads outnumber posts 20:1; building each feed when a post is published makes every read two cache lookups"
  rejected "Fan-out on read" "Every read would ask the graph for up to 5,000 followees and merge their posts from the database"
}
decision "Fan-out behind a queue" {
  because "Listing followers alone takes 50 ms and each post goes to ~200 feeds; the author gets 201 once the post is stored and the event is queued"
  rejected "Fan-out inside the request" "Publishing would wait for the graph and hundreds of cache writes"
}
decision "Store first, then fan out" because "A feed may only point at posts the database already holds; a failed fan-out is retried from the queue"
decision "Celebrities are out of scope" because "With at most 5,000 followers pure fan-out on write works; huge accounts would need their posts merged at read time"

usecase "Publish post" "Store a post and push it into the followers' feeds" {
  user    -> lb        : POST /posts json {"text": "Shipped the new release!"}
  lb      -> api       : POST /posts
  api     -> posts     : INSERT Post p_981
  posts  --> api       : ok
  api     -> events    : PostCreated p_981
  events --> api       : ack
  api    --> lb        : 201 {"id": "p_981"}
  lb     --> user      : 201 {"id": "p_981"}
  events ->> fanout    : PostCreated p_981
  fanout  -> graph     : GET /users/7/followers
  graph  --> fanout    : 200 [~200 follower ids]
  fanout  -> postCache : SET post:p_981
  fanout  -> feeds     : ZADD feed:<follower> p_981 (pipelined, ~200)
}

usecase "Read feed" "Show the newest posts of the people a user follows" {
  user       -> lb        : GET /feed
  lb         -> api       : GET /feed
  api        -> feeds     : ZREVRANGE feed:42 0 49
  feeds     --> api       : 50 post ids
  api        -> postCache : MGET post:p_981 …
  postCache --> api       : 50 posts
  api       --> lb        : 200 {"posts": [...]}
  lb        --> user      : 200 {"posts": [...]}
}
`,
  hints: [
    'Feeds are read 20 times more often than posts are written. Could each feed be ready before anyone asks for it?',
    'Precompute feeds into a cache when a post is published (fan-out on write); then a read is a lookup of post ids plus the posts themselves, also from a cache.',
    'Listing followers takes 50 ms and each post goes to ~200 feeds: do not make the author wait. Store the post, put an event on a queue, answer 201, and let a worker do the fan-out.',
    'Store the post before any feed points at it, and size the Feed API for 10.5k rps at well under 70% busy.',
  ],
};
