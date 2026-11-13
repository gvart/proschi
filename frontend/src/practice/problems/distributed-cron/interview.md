## Questions

### How many script runs a second, and is the rate steady?
- kind: good
- fact: 200 runs a second at the top of the minute, about 50 a second averaged over the whole minute

Not steady: **200 runs a second** at the top of the minute, about **50 a second** averaged over the whole minute. Size for the peak.

### How much can one worker take?
- kind: good
- fact: A worker replica completes about 10 runs a second

A worker replica completes about **10 runs a second**. Most scripts are short; a few run for up to an hour.

### Can a script still be running when it is due again?
- kind: good
- fact: About 1% of due scripts are still running from last time

Yes: about **1%** of due scripts are still running from last time, and a second copy must not start.

### Can the scheduler run the scripts?
- kind: good
- fact: The scheduler never runs a script

No. The scheduler never runs a script: it has no connection to the systems the scripts work on, and the scripts run on the worker pool.

### Does run state need to survive a crash?
- kind: good
- fact: Every run is recorded in a durable database before it is enqueued

Yes. Every run is recorded in a durable database before it is enqueued, and the worker updates it before and after the script.

### What availability and failure tolerance do you need?
- kind: good
- fact: Losing any single machine must not stop scripts from being scheduled or run

Fire must be available **99.9%** of the time, and losing any single machine must not stop scripts from being scheduled or run.

### Is there a budget?
- kind: good
- fact: At most $5,500 / month

At most **$5,500 a month**; the systems the scripts work on cost nothing here.

### Which cron library should the scheduler use?
- kind: weak

A library choice is an implementation detail. Ask what the scheduler is responsible for, and what happens when it goes down.

### Should the scripts be rewritten in Go?
- kind: weak

The language the scripts are written in does not change the architecture. Ask how many runs there are and how long they take.

### Can we use Kubernetes CronJobs?
- kind: weak

Naming a product skips the design. Ask what has to survive a machine failure, and how a script that is still running is detected; then a product can be judged against that.

## Estimates

### How many workers does the peak need at 100% busy?
- answer: 20
- unit: workers
- range: 15 to 25

200 runs a second ÷ 10 runs a second per worker = **20 workers**, with no headroom and nothing to spare when one is lost. About 30 keeps them under 70% busy.

### How many writes a second does the run table take?
- answer: 600
- unit: writes/s
- range: 400 to 800

Each Fire that enqueues inserts a row (about 200 a second), and each run updates its row twice, to in progress and to done (400 a second): about **600 writes a second**, far below what one primary takes.

### What is the peak-to-average ratio of runs?
- answer: 4
- unit: ×
- range: 3 to 5

200 runs a second at the top of the minute ÷ 50 a second averaged over the minute = **4×**. A pool sized for the average saturates at every burst.
