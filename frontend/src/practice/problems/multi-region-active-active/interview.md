## Questions

### How much traffic, and how is it split between the regions?
- kind: good
- fact: 8k Browse and 2k Save progress requests a second at peak, split 50/50 between the regions by geo-DNS

**8k Browse and 2k Save progress requests a second** at peak (assumptions for the exercise), split about **50/50** between US-East and US-West by geo-DNS.

### Can a request call the other region?
- kind: good
- fact: No request calls the other region while a member waits

No. **No request calls the other region while a member waits**: reads and writes are local, and replication is asynchronous.

### What happens to an evacuated region's members?
- kind: good
- fact: A member of an evacuated region touches nothing in that region

DNS sends them all to the other region, and **a member of an evacuated region touches nothing in that region**.

### How often does the cache answer?
- kind: good
- fact: EVCache answers 90% of Browse reads

**EVCache answers 90% of Browse reads**; for members just moved to the other region, assume **70%** while its cache warms.

### What latency and availability do we need?
- kind: good
- fact: Every use case available 99.99% of the time, Netflix's internal goal

p99 of Browse and Browse in failover under **100 ms**, of Save progress under **130 ms**, and every use case available **99.99%** of the time, Netflix's internal goal.

### What can one instance of each tier handle?
- kind: good
- fact: One Zuul instance takes about 10k requests a second, one playback API instance 2k

About **10k requests a second per Zuul instance**, **2k per playback API instance**, 100k per EVCache node and 20k per Cassandra node.

### Is there a budget?
- kind: good
- fact: At most $5,000 / month for both regions

At most **$5,000 a month** for both regions together.

### Which AWS instance types should we use?
- kind: weak

Instance types are a detail for later; ask how much load each region must carry when the other one fails.

### Should the app be rewritten in a different framework first?
- kind: weak

The code is not the risk here; a whole region failing is. Ask what must survive and how traffic moves between regions.

### What does the home screen show?
- kind: weak

A product question; ask how many requests a second the home screen causes and what data each one reads.

## Estimates

### On the day US-East is evacuated, how many Browse requests a second does US-West serve?
- answer: 8k
- unit: requests/s
- range: 7k to 9k

All of them: its own 4k and US-East's 4k, **8k a second**, double a normal day.

### In the model, one region carries 9k requests a second during the drill. At 2k per API instance, how many instances keep it near 70% busy?
- answer: 7
- unit: instances
- range: 6 to 8

At 70% an instance carries 1.4k: 9k ÷ 1.4k ≈ 6.4, so **7 instances**, 64% busy, and 75% after losing one.

### With 7 API instances per region, how busy is each region's API on a normal day?
- answer: 36
- unit: % utilisation
- range: 30 to 45

A normal day sends 5k a second (4k Browse, 1k writes) to 14k of capacity: about **36%**. The rest is the headroom that makes failover possible.

Numbers: [Numbers to know](../docs/numbers/).
