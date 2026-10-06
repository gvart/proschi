## Questions

### How many events a second?
- kind: good
- fact: 1,500 events per second at peak

**1,500 events a second** at peak, each handed over once and delivered once.

### How are events split across channels?
- kind: good
- fact: 55% of events go to users who prefer email, 30% push and 11% SMS

**55%** email, **30%** push, **11%** SMS, and 4% opted out.

### How fast and reliable are the providers?
- kind: good
- fact: about 200 ms per call when they work, and they have outages

Slow and flaky: about **200 ms** a call when they work, and they have outages.

### Can the Order Service wait for a provider?
- kind: good
- fact: The Order Service must never wait for a provider

Never: handing over an event takes under **50 ms** at p99.

### Can an accepted event be lost?
- kind: good
- fact: An accepted event is never lost, even if every provider is down for a while

No, even if every provider is down for a while.

### What if the SMS provider fails?
- kind: good
- fact: Losing any single machine, or the SMS provider, must not stop notifications

Losing any single machine, or the SMS provider, must not stop notifications.

### Is there a budget?
- kind: good
- fact: At most $2,000 / month, the Order Service and the Preferences service included

At most **$2,000 a month**, the Order Service and the Preferences service included.

### What should the email template say?
- kind: weak

Content, not architecture.

### Should we run our own SMS carrier?
- kind: weak

Far out of scope; ask how the providers behave instead.

### Do we need an admin page to edit templates?
- kind: weak

A nice tool, but it does not change the delivery path.

## Estimates

### How many emails a second?
- answer: 825
- unit: emails/s
- range: 700 to 950

1,500 × 55% = **825 a second**.

### How many SMS a second fail over to the second provider?
- answer: 15
- unit: messages/s
- range: 10 to 20

1% of all events: 1,500 × 1% = **15 a second**.

### With providers taking 200 ms a call, how many calls are in flight at 1,500 a second?
- answer: 300
- unit: calls
- range: 200 to 450

Little's law: 1,500/s × 0.2 s = **300 calls** in flight; workers must hold that many.

Numbers: [Numbers to know](../docs/numbers/).
