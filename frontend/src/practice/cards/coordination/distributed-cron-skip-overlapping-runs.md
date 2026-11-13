---
type: choice
difficulty: medium
tags: [databases]
related: [distributed-cron]
---

## Question

A cron script runs every 5 minutes but sometimes takes 20. Scripts now run
on any machine of a shared worker pool. How does the scheduler avoid
starting a second copy while the first is still running?

## Options

- [x] Record each run as a row (enqueued, in progress, done) in a shared database, and skip the script while it has an active row
- [ ] Take a `flock` on the lock file before the script starts
- [ ] Give the queue message a short time-to-live so a late copy expires
- [ ] Run the scheduler on a single machine so it never fires twice

## Why

A file lock only works when every run happens on the same machine. With
runs spread over a pool, the state has to live somewhere every machine and
the scheduler can see: a table of runs, indexed by script name so the "is it
still running?" lookup stays fast. The same table shows engineers whether a
long run is still going or has failed.
