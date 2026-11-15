## Questions

### How many ad events arrive at peak?
- kind: good
- fact: 20k ad events per second at peak, impressions and clicks together

About **20k ad events a second** at peak, impressions and clicks together (an assumption: Uber published hundreds of millions a week).

### What granularity do billing and the dashboards need?
- kind: good
- fact: Windows of one minute per ad

Counts **per ad and minute** are enough: hours and days are sums of minutes. About 30k ads have events in a given minute, so that is **500 aggregate records a second**.

### How many dashboard queries do advertisers make?
- kind: good
- fact: 1k dashboard queries per second from advertisers

About **1k dashboard queries a second**.

### Can a click be counted twice, or lost?
- kind: good
- fact: Aggregates are written in a Kafka transaction that is committed only after the checkpoint covering them is stored

Neither: clicks are billed. Aggregates are written in a Kafka transaction committed only after the checkpoint covering them is stored, and readers see committed records only.

### What may the app's request do?
- kind: good
- fact: Recording an event only appends it to Kafka

Only append the event to Kafka: no database, no Pinot and no budget service on the app's path.

### What can one Pinot server take?
- kind: good
- fact: One Pinot server takes 2k queries and 2k writes a second at 20 ms, for $600 / month

**2k queries and 2k writes a second** at 20 ms, for **$600 a month**.

### What are the limits and the budget?
- kind: good
- fact: At most $9,000 / month, the budget service and its ledger included

p99 of recording under **60 ms**, budget updates under **100 ms**, reports under **150 ms**; at most **$9,000 a month**, the existing budget service and ledger included.

### Which Flink version should we run?
- kind: weak

It does not change the design. Ask how exact the counts must be and how fresh.

### Should the dashboard be a React app?
- kind: weak

The front end is not what is assessed. Ask how many queries the dashboards make and what they ask for.

### Which ad formats are there?
- kind: weak

Formats do not change the pipeline. Ask how many events a second arrive and what granularity billing needs.

## Estimates

### How many replicas does the aggregation job need to stay under 70% busy after losing one, at 2k events a second each?
- answer: 16
- unit: replicas
- range: 15 to 20

20k ÷ (70% × 2k) ≈ 14.3, so 15 must survive: **16 replicas**, 63% busy (67% after losing one).

### How many writes a second reach Pinot once events are counted in one-minute windows per ad?
- answer: 500
- unit: writes/s
- range: 400 to 650

About 30k ads have events in a minute, one record each: 30k ÷ 60 = **500 writes a second**, 40 times fewer than the 20k events.

### How many Pinot servers for 500 writes and 1k queries a second, staying under 70% after losing one?
- answer: 3
- unit: servers
- range: 3 to 4

Each server takes 2k of each, so the load is 500 ÷ 2k + 1k ÷ 2k = 0.75 of a server. Two would be 75% after losing one: **3 servers**, 25% busy, 38% after losing one.

Numbers: [Numbers to know](../docs/numbers/).
