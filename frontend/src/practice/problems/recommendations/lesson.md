# Recommendations: a ranking funnel that spends the best model on the fewest items

```tldr
Serve a personalized page within a tight budget by **narrowing in stages**: **retrieval** picks 500 candidates with an embedding index, then ever **more expensive models rank ever fewer** of them (500 → 150 → 50 → 25). **Features and embeddings are precomputed** offline and read from fast online stores. Each model gets **its own pool, sized from its own cost per item**.
```

## What you'll learn

- Why a recommender cannot run its best model on every candidate, and how a **ranking funnel** keeps cost and latency bounded.
- What **candidate retrieval** does: from millions of posts to a few hundred with a nearest-neighbour lookup on **embeddings**, without scoring any post.
- Why **features are precomputed** offline and read from an online store, never from the warehouse they are computed in.
- How to **size one pool per model** from items per request, requests per second and items per machine.
- What the funnel costs in ranking quality, and how **distillation** limits that.

## The problem, explained

Instagram's Explore tab shows each person a grid of posts from accounts they do not follow yet. Over half of the Instagram community visits it every month, and the posts come from a pool of billions. Showing everyone the same popular grid would be cheap and dull; ranking every post for every person is impossible. Meta's answer, described in its 2019 post, is a funnel.

**Candidate generation** comes first. It starts from the person's *seed accounts*, the accounts whose posts they liked or saved, and looks up accounts that are similar to them. Similarity comes from **account embeddings**: Meta trains vectors (ig2vec, a word2vec-like model) on the sequences of accounts people interact with in a session, so accounts that are visited together end up near each other. A nearest-neighbour lookup finds the closest accounts, and their recent posts, filtered for eligibility, become the candidates. Each request samples **500** of them.

**Ranking** then takes three passes. A **distilled** model with minimal features scores all 500 and keeps 150. A **lightweight neural network** with the full set of dense features keeps 50 of those. A **deep neural network** with dense and sparse features orders the final **25**, which fill the first page. The deep model predicts several actions at once (like, save, "see fewer posts like this"), and a weighted sum of those predictions, with a penalty for showing the same author twice, is the final score.

The problem has two use cases. **Load Explore** runs the funnel while the user waits. **Refresh features** is the offline pipeline that reads the warehouse and refills the feature store and the embedding index. The tests check that retrieval runs before the first ranker and that the rankers run from cheapest to heaviest, that features are read from the online store and never from the warehouse while a user waits, and that users reach only the Explore API.

## Back-of-the-envelope

```numbers
500k / s | items for the first pass
50k / s | items for the deep model
100 | machines to run the deep model on everything
15 | machines it needs in the funnel
$16,100 | a month for the reference design
```

The request rate and the model speeds are assumptions for the exercise; the funnel's sizes are Meta's.

| Pass | Items per request | Items a second | Per machine | Machines (no headroom) |
|---|---|---|---|---|
| `light` (distilled) | 500 | 500k | 100k | 5 |
| `medium` (lightweight network) | 150 | 150k | 25k | 6 |
| `heavy` (deep network) | 50 | 50k | 5k | 10 |
| `heavy` on every candidate | 500 | 500k | 5k | 100 |

**The deep model on everything.** 1k requests × 500 candidates = 500k scores a second. At 5k a machine that is 100 machines before any headroom, about 140 to stay near 70% busy: some $85,000 a month at $600 each, four times the whole budget.

**The funnel.** The deep model sees only 50 items per request: 50k a second, 10 machines, 15 for headroom (67% busy, 71% after losing one). The two cheaper passes add 8 and 10 machines. All three pools together cost $13,600, a sixth of the deep model alone on everything.

**Latency.** The page waits for each pass in turn, so their latencies add: about 10 ms for the API, 10 ms for retrieval plus 15 ms for the index, 1 ms for the features, then 5, 10 and 40 ms for the three passes. That is about 90 ms idle, a little more under load, and about 260 ms at p99 in the simulation, under the 300 ms limit. A warehouse query, at half a second, would not fit even once.

## Concepts

### The ranking funnel

A recommender faces a trade-off between how good a model is and how many items it can afford to score. The best model uses hundreds of features and a deep network, and it costs tens of times more per item than a simple one. The candidate pool is large, and most of it is obviously wrong for this user: a cheap model can tell that much.

So the work is split into **passes**. Each pass scores what the previous one kept and passes on only its best. Early passes are cheap and see many items; late passes are expensive and see few. The expensive model's load is set by the *last* cut, 50 items a request, not by the size of the pool. That is what keeps both the bill and the latency bounded: the latency of each pass is one batched call, and the slowest pass sees the smallest batch.

```callout takeaway
**Spend the expensive model only on the survivors.** Its load is requests × the items left after the cheaper passes, so each cut in front of it divides its cost.
```

The cost of the funnel is **recall**: a post the first pass drops is never seen by the deep model, even if the deep model would have loved it. Meta reduces that loss by **distillation**: the first-pass model is trained on the recorded outputs of the main models, so it learns to imitate their ranking with far fewer features. A good funnel loses few of the items the final model would have chosen.

```quiz
recommendations-ranking-funnel
```

### Candidate retrieval with embeddings

Ranking needs a short list to start from. **Retrieval** builds it without scoring individual posts. Each account is a vector; accounts that people visit together have vectors that point the same way. Given the user's seed accounts, a **k-nearest-neighbour** (KNN) search over those vectors returns similar accounts, with cosine distance or a dot product as the measure. Meta runs this lookup with FAISS, its library for similarity search.

The index is built **offline**: the embeddings come out of a training job over logged sessions, and the index is reloaded when they change. At request time it only answers lookups, which is why it can be fast. The posts of the similar accounts are then filtered for eligibility (no content that is likely to violate policy, no spam) and sampled down to 500.

````deepdive Approximate nearest neighbours
An exact KNN search compares the query with every vector, which is too slow over millions of accounts. Approximate methods (inverted lists of clusters, graph indexes such as HNSW, product quantization to shrink the vectors) find nearly the same neighbours by looking at a small part of the index. They trade a few percent of recall for orders of magnitude of speed, the same trade the ranking funnel makes. Meta's 2023 post describes item embeddings generated daily offline and served from such an approximate index.
````

### Precomputed features and embeddings

A ranking model's inputs are **features**: how often this user liked posts from this author, how many saves the post got in the last day, the author's embedding. Most of them summarise long histories, so they change slowly and are expensive to compute. Computing them from raw logs while a user waits would take seconds.

So they are computed **offline**, in batches, from the warehouse where the interaction logs land, and written to an **online feature store**: a key-value store or cache that answers a batch of keys in about a millisecond. A request reads the features of all 500 candidates and of the user in one batched call, and each ranking pass uses the subset it needs. The warehouse stays an offline system: it answers in about half a second and serves a few hundred queries a second, fine for a pipeline and hopeless for 1k requests a second.

The cost is **staleness**: a feature is as old as the last batch that wrote it. Features that must be fresh (what the user tapped a minute ago) come from a streaming job instead; the simulation treats them all as one store.

```quiz
recommendations-precomputed-features
```

### Sizing each pass

Each model has its own cost per item and sees its own number of items, so each gets **its own pool**, sized from its own numbers:

> machines = requests a second × items per request ÷ items one machine scores a second

then enough extra that the pool stays near 70% busy after losing one machine. Pools that are the same size are wrong for at least two of the three: the distilled model idles while the deep model queues. Separate pools also scale independently: a new, heavier final model changes only its own pool.

```quiz
recommendations-heavy-model-load
servers-for-peak-load
```

## Designing it step by step

1. **The API.** Add an Explore API that the user calls; it will run the funnel. Nothing else is reachable from the user.
2. **Retrieval.** Add `retrieval` and its nearest-neighbour index `embeddings`. The API asks retrieval for candidates; retrieval looks up accounts near the seed accounts and returns 500 eligible posts.
3. **Features.** Add the online `features` store. The API reads the features of the 500 posts and of the user in one batched call before ranking.
4. **The three passes.** Add `light`, `medium` and `heavy`, and call them in that order. Use a fan-out label for the items each one scores, such as `x500 SCORE`, so that each pass carries the load of its batch.
5. **The offline pipeline.** Write "Refresh features": the given `pipeline` reads the `warehouse`, then writes `features` and `embeddings`. The serving path never touches the warehouse.
6. **Size every pool.** From the table above: about 8, 10 and 15 machines for the passes, two or three of everything else, and a look at the budget, where the deep model is more than half of the bill.
7. **Explain the trade-offs** in `decision` blocks: why a funnel, why precomputed features, why one pool per model.

## Common mistakes

- **The deep model on every candidate.** Retrieval hands all 500 posts straight to the best model. It needs about a hundred and twenty machines, several times the budget, and the funnel test fails because no cheaper pass comes first. It fails *Retrieval first, then ranking from the cheapest model to the heaviest* and the cost limit.
- **A funnel that never narrows.** Three passes in the right order, but each one re-scores all 500. The early passes save the later ones nothing, and the deep pool is as large as above. Only the cost limit catches it: the order is right, the numbers are not. Each pass must keep only its best.
- **Features from the warehouse.** The API queries the warehouse for the features of 500 posts on every request. At about half a second a query and a few hundred queries a second per node, the warehouse saturates and the p99 runs to seconds. It fails *Features are precomputed and read from an online store* and the p99 limit.
- **The same pool size for every model.** The funnel is right, but every pass gets ten machines. The deep model's 50k scores a second fill its ten machines completely, requests queue there, and losing one machine makes it worse. It fails the p99 limit and *survive any node failure*. Size each pool from its own load.

```callout pitfall
"Use a neural network to rank" is not a design. The interviewer wants to hear how many items each model sees, what one prediction costs, and how that adds up to machines and milliseconds.
```

## In the interview

- **Start with the numbers that force the funnel.** Candidates per request, requests a second and the cost of one prediction. Once 500k deep-model scores a second is on the board, the funnel follows.
- **Name the stages and their sizes.** Retrieval to hundreds, a cheap pass to about a hundred, a heavy pass to a few dozen, then re-ranking for diversity and integrity. Say what each stage uses: embeddings, few features, all features.
- **Expect "doesn't the first pass drop good items?"** Yes, that is the trade-off. Distillation trains the cheap model to imitate the expensive one, and offline replay measures how many of the final model's picks survive the earlier cuts.
- **Expect "how fresh are the features?"** Batch features are hours old; real-time signals (the last few taps) come from a streaming job into the same online store. Embeddings are rebuilt daily.
- **Expect "what if the ranking path is down?"** Serve a precomputed page: Meta's 2023 post mentions precomputing some users' recommendations off peak. Popular posts are a last resort.
- **Expect "how do you know it works?"** Online A/B tests on engagement, and offline metrics such as NDCG, which the distilled model is trained on.

## Further reading

- Ivan Medvedev, Haotian Wu and Taylor Gordon, [Powered by AI: Instagram's Explore recommender system](https://ai.meta.com/blog/powered-by-ai-instagrams-explore-recommender-system/), Meta AI blog, 2019: the system this problem is based on.
- Vladislav Vorotilov and Ilnur Shugaepov, [Scaling the Instagram Explore recommendations system](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/), Engineering at Meta, 2023: the later four-stage funnel, two-tower retrieval and caching embeddings.
- [FAISS](https://github.com/facebookresearch/faiss), Meta's library for similarity search over dense vectors.
- Paul Covington, Jay Adams and Emre Sargin, [Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/), RecSys 2016: the two-stage candidate generation and ranking design.
- Geoffrey Hinton, Oriol Vinyals and Jeff Dean, [Distilling the Knowledge in a Neural Network](https://arxiv.org/abs/1503.02531), 2015: training a small model on a large model's outputs.
- Chip Huyen, *Designing Machine Learning Systems*, chapter 7, "Model Deployment and Prediction Service" (batch versus online prediction, and serving precomputed features).
