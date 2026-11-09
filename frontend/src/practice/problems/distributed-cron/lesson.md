# Distributed cron: no single box to lose

```tldr
One cron machine that schedules *and* runs every script is a **single point of failure** that must keep growing. Split it: a small **scheduler** that only decides what is due and **enqueues** it, with a **standby** chosen by leader election; a **worker pool** behind a queue that runs the scripts, sized for the **top of the minute**; and a **table of runs** in a durable database, checked before each enqueue so a slow script is never started twice.
```

## What you'll learn

- Why a classic cron box is a single point of failure, and why a bigger box does not fix it.
- How to **separate scheduling from running**, and what each half needs.
- How **leader election with a standby** keeps exactly one scheduler firing without making it a new single point of failure.
- Why run state belongs in a **durable, shared database** once scripts run on many machines, and how it prevents overlapping runs.
- How to size a worker pool for a **bursty** arrival rate rather than its average.

## The problem, explained

Cron is the oldest scheduler there is: a crontab line such as `*/5 * * * *` says "run this every five minutes", and the cron daemon on that machine starts the script when the minute matches. For a handful of scripts on one server it is perfect.

Slack ran its scheduled scripts this way: one node held every script and one crontab with every schedule. As the scripts and their data grew, the node moved to ever larger machines, and any problem with that one box (provisioning, rotation, configuration) stopped *every* script at once. Its replacement, described in 2023, has three parts: a scheduler, the company's existing job queue, and a database table of runs.

You build the same shape, in two use cases:

- **Fire** starts at the `clock`, the minute tick. The scheduler looks up the script's active runs; in `"Enqueued"` there are none, so it records a new run and enqueues it; in `"Already running"` the last run has not finished and nothing is enqueued.
- **Run script** starts at the queue: a worker takes the run, marks it in progress, does the work against `backend` (Slack's systems), and marks it done.

The tests check that the scheduler never reaches `backend`, that a run is written to a database before it is enqueued, and that the scheduler has a standby; the requirements add latency, availability, losing any machine and a budget.

## Back-of-the-envelope

The scale numbers are assumptions: Slack did not publish how many scripts it runs.

```numbers
200 / s | runs at the top of the minute
50 / s | averaged over the minute
10 / s | runs per worker replica
20 | workers at 100% busy
30 | workers with headroom and a spare
```

**Bursts, not averages.** Cron strings have minute resolution, so every script due in a minute is due at its first second, and round times like `0 * * * *` pile up. That is also why Slack keeps the scheduler from going down at the top of a minute when it can. Here: 200 runs a second at peak against 50 over the whole minute, a 4× burst.

**The pool.** A worker replica completes about 10 runs a second (most scripts are short; how long each holds a worker is folded into that rate). At the peak:

| Workers | Busy at 200 runs/s | One lost |
|---|---|---|
| 8 (sized for the average) | 250% | 286% |
| 20 | 100% | 105% |
| 22 | 91% | 95% |
| 30 | 67% | 69% |

Twenty is the bare minimum and saturates the moment one machine goes. Thirty keeps the pool under 70% busy and still under 100% with one lost.

**The run table.** Every Fire reads the script's active runs and, when it enqueues, inserts a row: 200 reads and about 200 writes a second. Every run updates its row twice: 400 more writes. Six hundred writes a second is nothing for a primary that takes about 5,000; two replicas are for availability, not load.

**The budget.** Two scheduler pods ($200), a three-broker queue ($600), two database replicas ($800) and 30 workers ($3,000) come to about $4,600 of $5,500. Forty workers would not fit.

```callout takeaway
Size the worker pool for the **top of the minute**, with one machine lost, not for the average over the hour.
```

## Concepts

### The cron box as a single point of failure

A single cron machine is both the **clock** that knows what is due and the **engine** that runs it, so losing it loses both, with every run in progress. A larger box fixes running out of memory or CPU, not that: it is still one machine, and slower to replace.

A second, identical box is no answer either: two daemons reading one crontab fire every script twice. Something has to decide which copy fires.

### Separate scheduling from running

The two halves need opposite things. Scheduling is tiny: parse a few thousand cron strings, compare them with the clock once a minute, and send out messages. It must be **always up and on time**. Running scripts is heavy, varied and slow: some take a second, some an hour, some need lots of memory. It needs **many machines** and does not care which one a script lands on.

So the scheduler does nothing but decide and hand off. It writes each due run to a **queue**, and a pool of **workers** reads the queue and runs the scripts (the competing-consumers pattern: each message goes to exactly one worker). Slack did not even build the second half: its job queue (Kafka for durability, Redis for the jobs being worked on, then job workers) already ran billions of jobs a day, and each cron run became one more job.

The scheduler stays small, so it fails over in seconds and a heavy script cannot delay the next minute. Losing a worker loses only the runs on it. The pool scales with the scripts without touching the scheduler. The cost: a run now waits in a queue, and its state is spread over three machines, which is why the next two concepts exist.

```quiz
distributed-cron-scheduler-only-enqueues
competing-consumers
```

### Leader election and a standby

The scheduler must not be a new single point of failure, yet two schedulers firing at once would enqueue every script twice. The usual answer is **leader election**: run two or more copies, and let them agree that exactly one, the leader, fires. The others are **standbys** that watch the leader and take over if it stops renewing its claim.

Slack runs several scheduler pods on Kubernetes and uses Kubernetes leader election, which is built on a **lease**: the leader holds a record that expires unless renewed every few seconds. If the leader dies, the lease runs out and a standby takes it. This is **active-passive**: the standby does no scheduling until it leads. Slack decided against keeping several schedulers in sync: a new leader takes over quickly enough that downtime is unlikely, and with the scripts moved off, a pod has only scheduling to do.

The trade-off: a failover takes a few seconds, and runs due in that window fire late (or, if the scheduler does not catch up, are skipped). Timing matters: losing the leader just before the top of the minute is the worst moment, so planned restarts avoid it.

```deepdive Why leases and not a lock held forever
A lock held until released never frees itself when the leader crashes or is cut off; someone would have to prove the leader dead. A lease expires on its own. Its weakness is a leader that pauses (a long garbage collection, a frozen VM) and wakes after its lease ran out, still believing it leads, so two schedulers briefly fire together. A run table that refuses a second active run limits the damage; fencing tokens are the general fix.
```

```quiz
leader-lease
active-active-vs-active-passive
```

### Tracking runs in a database

On one box, "don't start this script if it is still running" is a file lock: the script takes a `flock` on a file, and a second copy that cannot get it exits. Slack's old cron did exactly that. It stops working the moment runs happen on different machines, because each machine has its own files.

So the state moves to a place everyone can see: a **table with one row per run**. Slack used a Vitess table (Vitess is sharded MySQL). A run's row moves through `enqueued`, `in progress` and `done`:

1. On Fire, the scheduler queries the script's active runs. An index on the script name keeps this lookup cheap.
2. If one is enqueued or in progress, the scheduler skips this run (`"Already running"`).
3. Otherwise it inserts a row with state `enqueued`, *then* enqueues the run. Writing first means a crash between the two leaves a visible row, not an invisible job.
4. The worker sets the row to `in progress` before the script and to `done` (or an error) after it.

The same table answers the question engineers ask most: is that hour-long script still running, or did it fail? Slack put a small page on top of it showing each run's state and errors.

Why a database and not Redis or the scheduler's memory? The state must outlive any one machine. If it lived in the scheduler, a failover would forget every run in progress and start them again. If it lived in a cache, a restart would do the same. A durable, replicated store keeps it through both.

```callout pitfall
The run table does not make runs *exactly once*. A worker that crashes mid-script leaves a row stuck in `in progress`, and the queue may hand a run to a second worker. Scripts still need to be safe to run twice, and stuck rows need a timeout.
```

```quiz
distributed-cron-skip-overlapping-runs
at-least-once-needs-idempotency
```

### Sizing the worker pool

The rate that matters is the **peak**: the top of the minute. Divide it by what one worker completes, then add headroom so the pool is not running hot, and one spare so that losing a machine does not tip it over. Little's law is the same idea from the other side: the number of runs in flight equals the arrival rate times how long each run takes, and every run in flight needs a slot on some worker.

A pool sized for the average fills up at every burst. Runs then wait in the queue, scripts start late, and the backlog grows each minute if the burst never fully drains. In the simulation, the workers saturate and the p99 of Run script climbs past its limit.

```quiz
workers-needed
littles-law-concurrency
```

## Designing it step by step

1. **Start from the use cases.** Fire goes from `clock` to the scheduler and ends at the queue. Run script starts at the queue and ends with the worker acknowledging the job. Write the steps before choosing replica counts.
2. **Add the scheduler, and only make it schedule.** One service, id `scheduler`, connected to the run table and the queue, and nothing else. No connection to `backend`: if the scheduler can reach it, someone will eventually run a script there.
3. **Add the queue.** Any durable queue or broker works. It is what lets the scheduler answer in milliseconds while a run waits for a worker.
4. **Add the run table.** A relational database, two replicas. In Fire, look up active runs first, then branch: `"Enqueued"` inserts the row and then enqueues; `"Already running"` answers without touching the queue.
5. **Add the worker pool**, id `workers`. In Run script: update the row to in progress, call `backend` for the script's work, update the row to done, acknowledge the job.
6. **Add the standby.** Two scheduler replicas. Write down in a `decision` that one leads and one waits.
7. **Size and check.** Workers for the peak plus a spare, then run the tests and read the cost.

## Common mistakes

- **The scheduler runs the scripts itself.** Two scheduler pods with leader election, but the leader executes every due script in-process: the old cron box, doubled. Losing the leader kills every run on it, and a memory-hungry script can make the next minute late. It fails *The scheduler only enqueues* and *Scripts run on the worker pool*. Enqueue, and let the workers run.
- **One scheduler, no standby.** Moving the scripts to workers removed one single point of failure and kept another: while the lone scheduler restarts, nothing fires. Fire's availability drops to the scheduler's own 99.5%, below 99.9%, and *A standby scheduler is ready to take over* fails. Run two and let leader election pick.
- **No run table.** The scheduler enqueues whatever is due, every time. A script that runs longer than its interval gets a second copy, then a third, and nobody can tell whether last night's run finished. It fails *Every run is recorded before it is enqueued*. Keeping the state in a cache instead fails the same test: it must survive a restart.
- **A pool sized for the average.** Eight workers handle 50 runs a second, the minute's average, and saturate at 250% when 200 arrive at once. It fails the p99 of Run script and surviving a node failure. Size for the burst.
- **Doubling the pool to be safe.** Forty workers pass every test but cost $5,600 with the rest, over the budget. Headroom is one spare and 70% busy, not double.

## In the interview

Open with the failure that motivates the design: "one cron box is a single point of failure, and two of them run everything twice." Then split scheduling from running, and say why each half needs different things. Expect the interviewer to push on the corners:

```callout interview
- *What happens to runs due during a failover?* They fire a few seconds late; the new leader can catch up on ticks it missed, or a script can be marked "skip if missed".
- *How do you stop two schedulers from firing at once?* Leader election with a lease; the run table refusing a second active run is a backstop.
- *What if a worker dies mid-script?* The row stays in progress; time it out, and make scripts safe to retry.
- *Why not a cache for run state?* It must survive a restart and be visible to every machine.
- *Why one job per script run?* Slack's job queue runs work fastest when each kind of work is isolated on its own queue, so one slow script does not hold up the others.
```

Have two numbers ready: the peak-to-average ratio, and workers = peak ÷ per-worker rate.

## Further reading

- Claire Adams, [Executing Cron Scripts Reliably At Scale](https://slack.engineering/executing-cron-scripts-reliably-at-scale/) (Slack Engineering, 2023): the single cron box, the Scheduled Job Conductor with Kubernetes leader election, the job queue and the Vitess table of runs.
- Saroj Yadav, Matthew Smillie, Mike Demmer and Tyler Johnson, [Scaling Slack's Job Queue](https://slack.engineering/scaling-slacks-job-queue/) (Slack Engineering, 2017): the job queue the cron runs are handed to.
- Štěpán Davidovič and Kavita Guliani, [Distributed Periodic Scheduling with Cron](https://sre.google/sre-book/distributed-periodic-scheduling/), in *Site Reliability Engineering* (Google): how Google's distributed cron uses a replicated leader and records launches to avoid double runs.
- [Kubernetes: Leases](https://kubernetes.io/docs/concepts/architecture/leases/): the lease objects behind leader election.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message queues, task queues and back pressure.
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter "The Trouble with Distributed Systems": leases, process pauses and fencing tokens.
