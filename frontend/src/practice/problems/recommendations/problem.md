---
title: Explore Recommendations
summary: "Instagram Explore's ranking funnel: 500 candidates, then ever heavier models rank ever fewer."
difficulty: hard
company: Meta
tags: [ranking, machine-learning, caching, read-heavy, estimation, real-world]
hints:
  - "The deep model is the best ranker and the most expensive one: 5k items a second per machine. How many machines would it take to score all 500 candidates of 1k requests a second? What if it only saw the best 50?"
  - "Put the passes in a row. Retrieval returns 500 posts; a distilled model (light) scores them all and keeps 150; a lightweight network (medium) keeps 50; the deep network (heavy) orders the last 25. A label like x500 SCORE counts 500 calls of load for one step."
  - "Features come from hours of logged interactions: that is batch work. Let \"Refresh features\" read the warehouse and write a feature store and the embedding index; \"Load Explore\" reads the features of all 500 candidates in one batched call to the store and never touches the warehouse."
  - "Size each pass from its own numbers: requests a second × items per request ÷ items one machine scores, then about 70% busy with one machine lost. The deep model's 50k scores a second at 5k a machine is the biggest pool by far."
---

Over half of the Instagram community visits Explore every month: a grid of
photos and videos from accounts they do not follow yet, picked for them out
of billions of posts. Meta's Explore system is a funnel. Candidate
generation finds a few hundred posts that might interest the user, and a
series of ranking passes, each more expensive per item than the last,
narrows them to the 25 that fill the first page.

The expensive part is the ranking: a deep neural network that predicts
likes, saves and "see fewer posts like this" is far too costly to run on
every candidate. The funnel spends it only on the few that cheaper models
already rated highly. Design the serving path for one Explore page, and the
offline job that keeps its features and embeddings fresh.

## Functional requirements

- **Load Explore**: a user opens Explore and gets a page of 25 ranked
  posts. In order:
  1. **Retrieval**: the `retrieval` service looks up accounts similar to the
     user's seed accounts (accounts they liked or saved posts from) in a
     nearest-neighbour index of account embeddings, `embeddings`, and
     samples **500** eligible posts from those accounts.
  2. **Features**: the features of the 500 posts and of the user are read
     from the online feature store, `features`, in one batched call.
  3. **First pass**: `light`, a distilled model with few features, scores
     the 500 and keeps the best **150**.
  4. **Second pass**: `medium`, a lightweight neural network with the dense
     features, scores the 150 and keeps the best **50**.
  5. **Final pass**: `heavy`, a deep multi-task network with dense and
     sparse features, scores the 50 and orders the best **25**.
- **Refresh features**: the given offline `pipeline` reads a batch of
  logged interactions from the `warehouse` and writes fresh features to
  `features` and fresh account embeddings to `embeddings`.

Name the nodes `retrieval`, `embeddings`, `features`, `light`, `medium` and
`heavy`: the capacity and the tests in `problem.proschi` refer to them, and
to the two use case names above.

## Scale

- **1k Explore loads a second** for the slice of traffic in this exercise.
- Each load ranks **500 candidates**, narrowed to **150**, then **50**,
  then **25**.
- One `light` machine scores **100k items a second** in about **5 ms** a
  batch, one `medium` machine **25k items a second** in about **10 ms**,
  and one `heavy` machine **5k items a second** in about **40 ms**; they
  cost **$200**, **$300** and **$600** a month. All three are set in
  `problem.proschi`'s `capacity`.
- The offline pipeline writes **50 batches a second**.
- The warehouse answers in about **half a second**, a few hundred queries a
  second per node.

The funnel's sizes (500, 150, 50, 25) and the three kinds of model are from
Meta's post. The request rate, the model speeds and prices and the
warehouse's numbers are assumptions for the exercise: Meta published only
fleet-wide totals (65 billion features extracted and 90 million model
predictions a second).

## Constraints

- p99 of loading Explore under **300 ms**, all three passes included.
- Explore available **99.95%** of the time.
- A request never queries the warehouse: features and embeddings are
  computed offline and read from online stores.
- Users reach only the Explore API, never the stores or the models.
- Losing any single machine must not break a latency limit.
- At most **$20,000 / month**, the warehouse and the pipeline included.

## What is given

`problem.proschi` declares the `user`, the `warehouse` of logged
interactions (two nodes), the offline `pipeline`, the speed and price of
each ranking model, the traffic, the requirements and the tests. Add the
Explore API, `retrieval` and its `embeddings` index, the `features` store,
the three ranking passes, their connections and the two use cases.

## What this model leaves out

- **Ranking quality.** The whole point of the deep model is that it ranks
  better, and the funnel trades a little of that for cost: a post the
  first pass drops is never seen by the deep model. Meta trains the
  distilled model on the main models' outputs so it drops few posts the
  deep model would have kept. The simulation measures load, latency and
  cost, not relevance, so quality appears only as the order of the passes
  in a test.
- **Feature freshness.** Precomputed features are minutes to hours old.
  How stale is acceptable, and which features must be real time, is a
  product question the simulation cannot weigh.
- **Eligibility, integrity and diversity.** Filtering out policy-violating
  content and spam before ranking, and spreading the page over many
  authors, are part of each step's label here, not separate work.
- **One batched call per pass.** A label like `x500 SCORE` counts 500 items
  of load but one round trip, as if the candidates were sent in one batch,
  which is how model servers are usually called. A model server's GPU
  batching and its memory for features are not modelled.

## Based on

- Ivan Medvedev, Haotian Wu and Taylor Gordon,
  [Powered by AI: Instagram's Explore recommender system](https://ai.meta.com/blog/powered-by-ai-instagrams-explore-recommender-system/),
  Meta AI blog, November 2019: over half of the Instagram community visits
  Explore every month; the system extracts 65 billion features and makes
  90 million model predictions a second; candidate generation starts from
  seed accounts the person interacted with, finds similar accounts with a
  nearest-neighbour lookup on word2vec-like account embeddings (ig2vec),
  and takes media from those accounts; ineligible and likely
  policy-violating content is filtered out; each request samples 500
  candidates, ranked in three passes: a distilled model with minimal
  features (500 to 150), a lightweight neural network with the full dense
  features (150 to 50), and a deep neural network with dense and sparse
  features (50 to 25, the first page); the distilled model is trained on
  the main models' recorded outputs; the final score is a weighted sum of
  predicted actions with a diversity penalty.
- Vladislav Vorotilov and Ilnur Shugaepov,
  [Scaling the Instagram Explore recommendations system](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/),
  Engineering at Meta, August 2023: the funnel as retrieval, first-stage
  ranking, second-stage ranking and final reranking; item embeddings
  generated daily offline and served from an approximate nearest-neighbour
  index, with user and item embeddings cached for efficient inference; a
  lightweight first-stage model that distils the second stage; a heavier
  multi-task, multi-label model in the second stage.
