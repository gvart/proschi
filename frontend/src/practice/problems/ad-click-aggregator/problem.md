---
title: Ad Click Aggregator
summary: "Uber Eats ads: Kafka, one-minute Flink windows committed at each checkpoint, Pinot."
difficulty: medium
company: Uber
tags: [streaming, aggregation, exactly-once, olap, real-world]
hints:
  - "A click is money: counted twice, the advertiser is overcharged; lost, Uber loses revenue. What is the least the app's request can do and still never lose an event?"
  - "Use two Kafka topics. A Flink job reads `events`, keeps each ad's counts for the current minute in memory, and writes one record per ad and minute to `aggregates`. Pinot (\"Load aggregates\") and the budget service (\"Update budget\") read only `aggregates`."
  - "For exactly once, \"Publish aggregates\" produces into an open Kafka transaction, and \"Checkpoint\" first stores the job's state in object storage, then commits that transaction."
  - "Size the ingest and aggregation tiers for 20k events a second at well under 70% busy (about 2k per replica), and Pinot for its writes and queries at 2k each per replica, with room to lose one. All of it has to fit in $9,000."
---

Uber Eats shows restaurants' ads in its app, and every ad the app shows
(an **impression**) and every tap on one (a **click**) is an event.
Restaurants pay for those events, so they have to be counted exactly once:
a click counted twice overcharges the advertiser, and a lost one is lost
revenue and an under-reported campaign. The counts feed two readers: the
**Ad Budget Service**, which spends each campaign's budget and paces its
ads, and the **dashboards** where advertisers watch their campaigns. Both
need the numbers within minutes, not the next day.

Uber built this on Kafka, Flink and Pinot. The app's events go into a
Kafka topic. A Flink job filters out invalid events, drops duplicates,
and counts each ad's clicks and impressions in one-minute windows. Its
output goes to a second topic in Kafka transactions that are committed
only when Flink checkpoints, and the budget service and Pinot, the store
behind the dashboards, read only committed records. Design that pipeline.

## Functional requirements

- **Record event**: the app reports an impression or a click. The event is
  stored durably and the app gets a `202`.
- **Aggregate events**: the aggregation job takes an event from Kafka,
  checks it, drops it if it is a duplicate, and adds it to the count of its
  ad for the current minute, held in the job's state.
- **Publish aggregates**: a one-minute window closes, and the job writes its
  record (the ad, the minute, its clicks and impressions, and a record UUID)
  into the open Kafka transaction on the aggregates topic.
- **Checkpoint**: every two minutes, the job stores a snapshot of its state
  (open windows, recent event ids, Kafka offsets) and only then commits the
  transaction holding the records written since the last one.
- **Load aggregates**: Pinot ingests the committed aggregates, upserting by
  record UUID.
- **Update budget**: the Ad Budget Service reads a committed aggregate and
  spends the campaign's budget, once per record UUID.
- **View report**: an advertiser opens a campaign's dashboard, which shows
  its clicks and impressions over a time range.

Name the raw events topic `events` and the aggregates topic `aggregates`
(both `[Kafka]`), and Pinot `pinot`: the tests in `problem.proschi` refer to
them, to the given `budget` and `ledger`, and to the use case names above.

## Scale

Uber's post gives one rate: **hundreds of millions of ad events a week**
in 2021, on the order of a thousand a second on average. Every number below is an
assumption for the exercise, for a pipeline built to take the meal-time
peaks and years of growth.

- **20k ad events per second** at peak, impressions and clicks together.
- Windows of **one minute per ad**: about 30k ads have events in a given
  minute, so **500 aggregate records per second** reach Pinot and the
  budget service.
- **1k dashboard queries per second** from advertisers.
- One Pinot server takes **2k queries and 2k writes a second** at
  **20 ms**, for **$600 / month**.
- The Ad Budget Service (2 instances) and its ledger (2 PostgreSQL
  replicas) exist and stay as they are.

## Constraints

- Recording an event only appends it to Kafka: no database, no Pinot and
  no budget service on the app's path.
- The aggregation job keeps its windows in memory: it never writes a
  database, Pinot or the budget service per event.
- Aggregates are written in a Kafka transaction that is committed only
  after the checkpoint covering them is stored.
- Pinot and the budget service read only the committed aggregates, never
  the raw events topic.
- Dashboards query Pinot through a report service, never the raw events.
- p99 of **Record event** under **60 ms**, of **Update budget** under
  **100 ms** and of **View report** under **150 ms**. p99 of **Aggregate
  events** under **50 ms**: the simulation has no consumer lag, so this
  stands in for "the job keeps up with the stream".
- **Record event** available **99.95%** of the time, **View report**
  **99.9%**.
- Losing any single machine must not break a latency limit.
- At most **$9,000 / month**, the budget service and its ledger included.

## What is given

`problem.proschi` declares the `app` and the `advertiser` (the clients),
the `budget` service and its `ledger`, which already exist, and Pinot's
capacity. It holds the traffic, requirements and tests. Add the ingest
tier, the two Kafka topics, the aggregation job and its checkpoint store,
Pinot, the report service, the connections and the seven use cases.

## What this model leaves out

- **Exactly-once itself.** The simulation counts requests, not records, so
  it cannot see a duplicate. The tests check the shape that makes exactly
  once possible: aggregates committed only after a checkpoint, and every
  reader on the committed topic. Deduplication by event id in Flink's
  state, `read_committed` consumers and upserts by record UUID are in the
  design's labels and the lesson, not the numbers.
- **Windows and time.** The windows are not simulated: counting an event
  is a call that touches nothing else, and the delay of up to one
  checkpoint interval before an aggregate is visible is not measured.
- **Attribution.** Uber's pipeline also matches ad events to Uber Eats
  orders, through a second Flink job and cleaned events kept in Docstore
  for as long as the attribution window. That job is left out.
- **Two regions.** Uber ran the jobs in two regions and merged their
  output with a third, Union and Load, job that feeds Pinot and Hive. This
  exercise is one region and leaves out Hive.
- **Rates.** Every rate, size and price is an assumption; Uber published
  only the weekly event volume.

## Based on

- Jacob Tsafatinos, Yuriy Bondaruk and Yupeng Fu,
  [Real-Time Exactly-Once Ad Event Processing with Apache Flink, Kafka, and Pinot](https://www.uber.com/blog/real-time-exactly-once-ad-event-processing/),
  Uber Engineering blog, September 2021: the requirements (speed for
  pacing and advertiser reporting, reliability because lost events are
  lost revenue, accuracy because double-counted clicks overcharge
  advertisers), the Mobile Ad Events topic, the Aggregation job that
  filters invalid events, deduplicates them with Flink keyed state and
  counts clicks and impressions per ad in one-minute tumbling windows,
  Kafka transactions committed by a two-phase commit at each checkpoint,
  `read_committed` consumers, a checkpoint every two minutes rather than
  Flink's default ten, 3-day topic retention, record UUIDs used as
  idempotency keys by the Ad Budget Service, as upsert keys in Pinot and
  for deduplication in Hive, the Attribution and Union and Load jobs, two
  regions, and hundreds of millions of ad events a week.
