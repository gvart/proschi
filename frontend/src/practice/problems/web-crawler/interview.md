## Questions

### How many pages a month, and so a second?
- kind: good
- fact: about 1.8k pages a second, 4.5 billion a month

**About 1.8k pages a second**, 4.5 billion a month. The frontier hands out 2k URLs a second: 2% of fetches fail and 10% find the host busy.

### How big is a page, and how long does a fetch take?
- kind: good
- fact: A page is about 100 KB of HTML, and a fetch takes about 300 ms

About **100 KB** of HTML, and about **300 ms** per fetch.

### How many links does a page have, and how many are new?
- kind: good
- fact: A page has about 50 links; about 3 of them are URLs the crawler has never seen

About **50 links**, of which about **3** have never been seen.

### How many URLs and hosts are we talking about?
- kind: good
- fact: About 10 billion URLs are known, on 100 million hosts

About **10 billion URLs on 100 million hosts**: the seen set must hold all of them.

### How polite must we be?
- kind: good
- fact: at most one request to a host at a time, never sooner than its crawl delay, and never against its robots.txt

**One request to a host at a time**, never sooner than its crawl delay, never against robots.txt. A URL whose host is not ready goes back, it is not dropped.

### What happens to the frontier if a machine dies?
- kind: good
- fact: The frontier is durable: a restart or the loss of a machine loses no URL

Nothing: **the frontier is durable**, and a URL leaves it only once its page is stored or it is back for a retry.

### What is the budget?
- kind: good
- fact: At most $4,000 / month, page storage included

**$4,000 a month**, page storage included.

### Which HTML parsing library should we use?
- kind: weak

An implementation detail; ask how many links a page has and how many are new, which sizes the deduplication.

### Should the crawler be written in Python or Go?
- kind: weak

The language does not change the architecture; ask about the crawl rate and politeness rules.

### Should we rank the pages as we crawl them?
- kind: weak

Ranking belongs to the indexer, not the crawler; ask what the crawler must guarantee instead (no lost URLs, politeness).

## Estimates

### How many links a second must the seen-URL set check?
- answer: 90k
- unit: checks/s
- range: 75k to 110k

1.8k pages × 50 links = **90,000 checks a second**: the busiest component of the crawler.

### How much memory does a Bloom filter for 10 billion URLs take at a 1% false-positive rate (about 10 bits a URL)?
- answer: 12
- unit: GB
- range: 9 to 16

10B × 9.6 bits ≈ 96 Gbit ≈ **12 GB**, against about 80 GB for an exact set of 8-byte hashes.

### How many megabytes a second do the fetchers download?
- answer: 180
- unit: MB/s
- range: 150 to 210

1.8k pages × 100 KB = **180 MB/s**, and the same again on the way to the page store.

Numbers: [Numbers to know](../docs/numbers/).
