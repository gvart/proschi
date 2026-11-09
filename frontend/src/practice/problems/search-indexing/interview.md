## Questions

### How many searches and edits a second at peak?
- kind: good
- fact: 10k searches a second

About **10k searches a second** at peak, and **2k edits a second**, each one change event. These are assumptions for the exercise.

### Is there bulk data to index besides live edits?
- kind: good
- fact: The backfill streams 10k ETL rows a second, spread over the day

Yes: a nightly ETL computes scores and tags for every item, and the backfill streams **10k rows a second**, spread over the day, through the same pipeline.

### What can one search node take?
- kind: good
- fact: An Elasticsearch node serves about 3k requests a second

About **3k requests a second** per Elasticsearch node, queries and writes together.

### May the search path read the database?
- kind: good
- fact: Searches never call db, and no client connects to it

No. Searches never call the database, and no client connects to it: the database is for edits and the indexers.

### How fast must search and edits be, while a backfill runs?
- kind: good
- fact: p99 of a search under 120 ms, of an edit under 150 ms, with the backfill running

p99 of a search under **120 ms** and of an edit under **150 ms**, with the backfill running.

### What happens when a search node dies?
- kind: good
- fact: Every shard of the index has at least two copies

Every shard keeps at least **two copies**, and losing any one machine must not break a latency limit.

### Is there a budget?
- kind: good
- fact: At most $8,000 / month, the database and the loader included

At most **$8,000 a month**, the database and the loader included.

### Should we use Elasticsearch or Solr?
- kind: weak

Both are inverted-index search engines with shards and replicas; the choice does not change the design. Ask how fresh results must be and how heavy indexing is.

### Which ranking model orders the results?
- kind: weak

Relevance is a product and ML question. For the system, the scores arrive with the ETL rows; ask how many of those rows there are.

### Should the indexers be written in Java or Python?
- kind: weak

The language does not change the load. Ask how many changes a second reach the indexers.

## Estimates

### Without bulk requests, how many writes a second reach the search cluster?
- answer: 12000
- unit: writes/s
- range: 10000 to 14000

2k edits + 10k ETL rows = **12k writes a second**, more than the 10k queries. With bulk requests of about 100 documents, 1% of that: **120 a second**.

### How many search nodes do the queries need at 3k each, before any headroom?
- answer: 4
- unit: nodes
- range: 3 to 5

10k ÷ 3k ≈ **3.3, so 4 nodes**. With 3 shards of 3 copies (9 nodes), each shard takes 3.3k over 3 nodes, about 37% busy, and still about 56% after losing one.

### How busy are 8 Search API instances at 2k requests a second each?
- answer: 62
- unit: percent
- range: 55 to 70

10k ÷ (8 × 2k) = **62.5%**, and 10k ÷ 14k ≈ 71% after losing one: just inside the comfortable range.

Numbers: [Numbers to know](../docs/numbers/).
