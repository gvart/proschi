---
title: Distributed Cron
summary: "Slack's cron: a leader-elected scheduler that only enqueues, a worker pool and a table of runs."
difficulty: medium
tags: [scheduling, queues, availability, leader-election, real-world]
company: Slack
version: 2
strict: true
hints:
  - "The old cron box both decided when a script was due and ran it, on one machine. Split those two jobs: what must be small and always up, and what needs CPU, memory and many machines?"
  - "The scheduler should only enqueue: \"Fire\" goes from the clock to the scheduler and ends with a write to a queue, and never reaches the systems the scripts work on. \"Run script\" starts at the queue, and the workers do the work."
  - "Run two scheduler pods (x2): leader election lets one fire while the other stands by. Before enqueueing, look up the script's active runs in a database and INSERT a row for the new run; in \"Already running\" nothing is enqueued. The worker UPDATEs the row to in progress before the script and to done after it."
  - "The top of the minute is the peak: 200 runs a second at 10 per worker is 20 workers at full load. Keep them well under 70% busy and still under 100% with one lost (about 30), and watch the budget."
---

Slack ran its cron scripts the classic way: one big machine held every
script and a single crontab with all their schedules. As the scripts and
the data they processed grew, the machine was moved to bigger and bigger
instances, and it stayed a **single point of failure**: a problem with
provisioning, rotation or configuration on that one box stopped every
script.

The replacement splits the job in three. A small scheduler service decides
what is due and only enqueues it; other copies stand by, and leader
election decides which one fires. Slack's existing job queue and its
workers run the scripts. A table records every run and its state, so a
script whose last run is still going is not started twice, and engineers can
see what ran and what failed.

## Functional requirements

- **Fire**: every minute the clock ticks, and for each script whose cron
  string matches, the scheduler hands a run of it to the job queue. It
  starts at `clock`. Two scenarios:
  - `"Enqueued"`: no run of the script is enqueued or in progress, so the
    scheduler records a new run and enqueues it.
  - `"Already running"`: the previous run has not finished; the scheduler
    skips this one and enqueues nothing.
- **Run script**: a worker takes the next run from the queue, marks it in
  progress, runs the script against Slack's systems (`backend`), and marks
  it done.

Name the scheduler `scheduler` and the worker pool `workers`: the tests and
the workers' capacity in `problem.proschi` refer to them, and to the use
case and scenario names above.

## Scale

Slack has not published how many cron scripts it runs or how often; these
numbers are assumptions for the exercise.

- Most cron strings fire at the start of a minute, so runs come in bursts:
  **200 runs a second** at the top of the minute, about **50 a second**
  averaged over the whole minute. Size for the peak: that is the rate of
  both use cases.
- About **1%** of due scripts are still running from last time.
- A worker replica completes about **10 runs a second**. Most scripts are
  short; a few run for up to an hour.

## Constraints

- The scheduler never runs a script: no connection from the scheduler to
  `backend`, and the scripts run on the worker pool.
- Every run is recorded in a durable database before it is enqueued, and
  the worker updates it before and after the script.
- p99 of **Fire** under **100 ms**.
- p99 of **Run script** under **110 ms**. In this model that is the
  worker's own handling of a run, not the script's run time; it climbs when
  the pool is too busy, so it stands for "a due script starts without
  waiting for a free worker".
- Fire available **99.9%** of the time.
- Losing any single machine must not stop scripts from being scheduled or
  run.
- At most **$5,500 / month**; `backend` costs nothing here.

## What is given

`problem.proschi` declares the `clock` (the minute tick that starts every
**Fire**) and `backend` (the databases and APIs the scripts work on, already
running), the workers' capacity, and holds the traffic, requirements and
tests. Add the scheduler, the job queue, the worker pool, the run-state
database, the connections and the two use cases.

## What this model leaves out

- **No overlapping runs** is behaviour the simulation cannot check: it does
  not know which script a run belongs to or how long it lasts. The problem
  encodes it as a flow: the run is recorded before it is enqueued, and the
  "Already running" scenario never reaches the queue. Its 1% share is the
  scenario mix, not something the lookup earns.
- Leader election is not simulated either. The model spreads Fire over
  both scheduler pods, where in the real service one leads and the other
  waits; the second pod counts here as the standby that takes over when
  the first is lost.
- How long a script holds a worker (seconds to an hour) is folded into the
  per-replica rate of 10 runs a second, and the scripts' own run time is
  not part of any latency.
- Retries of failed runs and the page that shows each run's state are not
  modelled.

## Based on

- Claire Adams, [Executing Cron Scripts Reliably At Scale](https://slack.engineering/executing-cron-scripts-reliably-at-scale/),
  Slack Engineering, September 2023: the single cron box with one crontab
  that kept moving to larger machines and was a single point of failure;
  the Scheduled Job Conductor, a Go service on Bedrock (Slack's Kubernetes
  wrapper) that keeps the cron string format, runs several pods with
  Kubernetes leader election so one schedules while the others stand by,
  and only schedules, leaving the CPU- and memory-heavy work to the job
  queue; one job per script on Slack's job queue (Kafka, then Redis, then a
  job worker); and a Vitess table with a row per run (enqueued, in
  progress, done), queried by an index on the script name before a run
  starts, which replaces the old `flock` and backs a page showing each
  run's state and errors, since some scripts run for up to an hour.
