## Questions

### How many searches and location updates a second at peak?
- kind: good
- fact: 6k searches a second

About **6k searches a second** at peak, and **3k location updates a second**. These are assumptions for the exercise.

### Is the load spread evenly over the map?
- kind: good
- fact: 40% of them from dense metros that cover well under 1% of the land

No: **40%** of the searches come from dense metros that cover well under 1% of the land.

### How many shards does one search have to read?
- kind: good
- fact: A search circle covers about 3 geoshards

If the index is split by location, a search circle covers about **3 geoshards**. The index needs at least **7** to hold it.

### What can one search node take?
- kind: good
- fact: An Elasticsearch node serves about 3k requests a second

About **3k requests a second** per Elasticsearch node, searches and writes together.

### May searches read the profile store?
- kind: good
- fact: Searches never read profiles, and no client connects to the index

No. Searches never read `profiles`, and no client connects to the index directly.

### How fast must searches and location updates be?
- kind: good
- fact: p99 of a search under 150 ms, of a location update under 80 ms

p99 of a search under **150 ms**, of a location update under **80 ms**.

### What happens when a search node dies?
- kind: good
- fact: Every geoshard has at least two copies

Every geoshard keeps at least **two copies**, and losing any single machine must not break a latency limit.

### Is there a budget?
- kind: good
- fact: At most $13,500 / month

At most **$13,500 a month**, the profile store included.

### Which matching algorithm ranks the candidates?
- kind: weak

Ranking is a product and ML question. For the system, ask how many candidates a search reads and from how many shards.

### Should we use S2 or geohash?
- kind: weak

Either names cells on the map; the design question is how cells are grouped into shards. Ask where the users and the searches are concentrated.

### Should the router be written in Go or Java?
- kind: weak

The language does not change the load. Ask how many searches a second reach it and how many shards each one reads.

## Estimates

### If the index is sharded by user id into 7 shards, how many searches a second does each shard serve?
- answer: 6000
- unit: searches/s
- range: 5000 to 7000

Every search asks all 7 shards: 6k × 7 = 42k shard searches, ÷ 7 = **6k a second per shard**, as many as the whole service. Sharded by location, a search reads 3 geoshards: 6k × 3 ÷ 7 ≈ 2.6k per geoshard.

### How many requests a second reach the metro geoshards?
- answer: 8550
- unit: requests/s
- range: 7000 to 10000

Searches: 6k × 40% × 3 geoshards = 7.2k. Writes: 3k updates × 45% (staying in a metro, or moving into one) = 1.35k. Together about **8.6k a second**, close to 3 nodes of pure work before any headroom.

### With 3 metro geoshards of 3 copies, how busy is a geoshard's last two copies after losing one?
- answer: 48
- unit: percent
- range: 40 to 55

Each geoshard takes 8.55k ÷ 3 = 2.85k a second. On three copies that is 2.85k ÷ 9k ≈ 32%; on the two left after a loss, 2.85k ÷ 6k ≈ **48%**.

Numbers: [Numbers to know](../docs/numbers/).
