## Questions

### How many downloads, uploads and listings a second?
- kind: good
- fact: Downloads: 500 rps

**500 downloads**, **2k folder listings** and **200 uploads** a second.

### Are most downloads for the same files?
- kind: good
- fact: 90% of them for files that were fetched recently

Yes: **90%** of downloads are for files that were fetched recently.

### How big is a file?
- kind: good
- fact: The average file is 1 MB

The average file is **1 MB**; a user's connection moves about 10 MB/s.

### What does sending data to users cost?
- kind: good
- fact: $0.09 per GB from the bucket or any other component you run, $0.02 per GB from the CDN

**$0.09 per GB** from the bucket or anything you run, **$0.02 per GB** from a CDN; copies inside the system are free.

### When can an upload be acknowledged?
- kind: good
- fact: An upload is acknowledged only once its bytes are stored durably

Only once its bytes are stored durably, and a pending file is recorded before its upload URL is handed out.

### Can clients read the metadata store directly?
- kind: good
- fact: Clients never reach the metadata store directly

No, clients never reach the metadata store directly.

### Is there a budget?
- kind: good
- fact: At most $45,000 / month, egress included

At most **$45,000 a month**, egress included: about 1.3 PB leaves the system every month.

### Is the client a desktop app or a web page?
- kind: weak

Either uploads the same bytes. Ask about sizes, rates and costs.

### Which file types do we support?
- kind: weak

Bytes are bytes to the storage layer; the type does not change the design.

### Should we write our own storage engine?
- kind: weak

Building what object storage already offers is rarely the answer; ask about the constraints first.

## Estimates

### How much data leaves the system a month at 500 downloads a second of 1 MB?
- answer: 1.3
- unit: PB
- range: 1 to 1.6

500 × 1 MB = 500 MB/s × 2.6M seconds a month ≈ **1.3 PB a month**.

### What does that egress cost a month if it is served from the bucket at $0.09/GB?
- answer: 117k
- unit: USD/month
- range: 90k to 140k

1.3M GB × $0.09 ≈ **$117,000 a month**, far over the budget.

### And from a CDN at $0.02/GB?
- answer: 26k
- unit: USD/month
- range: 20k to 32k

1.3M GB × $0.02 ≈ **$26,000 a month**: where the bytes leave from decides the bill.

Numbers: [Numbers to know](../docs/numbers/).
