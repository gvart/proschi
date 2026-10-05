# Writing game scenarios

**Scale or Fail** is the system design game on the Interview prep page
([play it](https://proschi.app/practice/#/arcade)). You
pick a scenario, place components on a board by tapping or dragging, and keep
the system up while traffic grows, new use cases arrive and the requirements
tighten. Every number comes from Proschi's simulation, and every failure says
why it happened and what a senior engineer would do.

This page explains how the game works and how to add to it: scenarios, tech
cards, incidents and components are plain files in
`frontend/src/game/content/`, checked by `proschi game check`.

## How a run works

A run is twelve **waves** in three acts. Each wave is a month of traffic:

1. **Forecast.** The traffic curve and its peak per use case, the
   requirements in force (as Proschi lines), and the incidents coming (with
   their tick, below difficulty 1).
2. **Plan.** Place, wire, scale out (replicas), scale up (sizes S, M, L),
   shard, remove. Nothing is timed. A **load test** shows the plan at the
   forecast peak for $100. The board is drawn on the editor's canvas (the
   same nodes and connections as a diagram), and **Code** shows it as
   Proschi text you can edit instead: one line per component
   (`api "App Server" [Service] x3`), one per wire, and `size` and `shards`
   in a `capacity` block. Which use cases an app server handles is set in its
   settings.
3. **Run.** Eight ticks, each one simulated with the wave's traffic at that
   point of the curve. Once a wave you can page the **on-call** to add a
   replica mid-run ($200).
4. **Score and debrief.** Revenue, cost, interest and bonuses. If anything
   broke, the debrief shows the bottleneck, the simulation's hint and the
   review cards that explain it.
5. **Draft.** Take one of three **tech cards**, or skip it for $100.
   Rerolls cost $150, then $50 more each. After waves 2, 5 and 8, choose one
   of three **contracts**: a new use case for more revenue, stricter
   requirements for a multiplier, or cash now.

Waves 4, 8 and 12 are **bosses**: a launch, a holiday, a Super Bowl ad. After
wave 12 you can bank the score or keep going in **Endless** (traffic ×1.3 a
wave, two incidents, up to wave 24).

### Cash, Trust and score

- **Cash** starts at the scenario's seed round. Each tick adds the revenue of
  the requests that succeeded and takes the cloud bill (the simulation's
  monthly cost, egress included, over the ticks). At the end of a wave you get
  5% interest, at most $100. Below $0 at the end of a wave, the run is over
  (bankrupt).
- **Trust** starts at 100. Each tick, a missed latency limit costs 3, a missed
  availability limit 5, a lost zone you could not survive 5, dropped requests
  1 per 2% (at most 10), a use case with no route 8, a backlog older than its
  freshness limit 2, a seat sold twice 5. A clean wave gives 5 back, a boss
  15. At 0, users churn and the run is over.
- **Score** is the revenue of every tick × quality × the uptime streak. Quality
  is 1 for a clean tick, 0.6 with a latency, cost or freshness breach, 0.4
  with anything worse. The streak grows by 0.1 per clean tick up to ×3, and
  any breach resets it. A wave where every compute and store node stays under
  75% at the peak, none could lose a replica and stay there, and something
  works above 40% earns the **right-sized** bonus (+15%). Bosses add
  500 × the act. The end adds Trust × 10 and cash ÷ 10.

### Progression

A run earns **Blueprints**: 1 per wave survived, 3 per boss, 1 per 2 500
points (at most 10), and 5 for a scenario's first clear. Blueprints buy:

- **Components.** The first run has a load balancer, app servers and a SQL
  database. Caches, CDNs, queues and workers, firewalls, object storage,
  gateways, NoSQL, search and warehouses are unlocked one by one, each with a
  short intro to what it solves, what it costs and how it fails.
- **Features:** instance sizes, sharding, wider lanes.
- **Rare cards** for the draft (common and uncommon ones are in from the
  start).
- **Perks**, permanent and equipped into up to three slots: more seed money,
  more Trust, a free reroll, a starting card, a free load test, a second
  pager.

Scenarios open as you reach waves in earlier ones, and each has ten
**difficulty levels** (ascensions): you may play one above the highest you
cleared. Unlocks and perks count on the leaderboard; each scenario and
difficulty has its own board, and there is a daily run with the same seed for
everyone.

## Design-first modes

Scale or Fail is the arcade mode. The others put the design first: no card
draft, no rerolls, no boss names. Each wave a **ticket** lands in the inbox,
from the product manager, the CTO, a customer, legal, finance or marketing,
and asks for something real: a feature, a launch, an SLA, a law. The cash,
Trust and score rules are the same, and so are the leaderboards.

**Chaotic Startup** (Pawprint) is about change. Besides scaling, it has:

- **API versions.** A breaking change ships as a new use case (v2) next to the
  old one. Old clients keep calling v1, with traffic falling wave by wave.
  Once v2 is live, v1 costs its `upkeep` every wave until you **sunset** it,
  and sunsetting it while it still has traffic gives those clients 410 Gone
  (a `compat` breach, every tick).
- **Migrations.** A schema change goes expand → dual-write → backfill →
  cutover → contract, one phase a wave (each is a deploy), and can be rolled
  back until the contract. Dual writes double the writers' writes on the
  store; the backfill adds a background job; the use cases that need the new
  shape are served from the cutover; and the contract drops the old shape,
  which breaks any use case still reading it (`compat`). **All at once** jumps
  to the end: the store's writes lock for two ticks (a `migration` breach).

**On-call** (Dinnerbell) is about incidents. Each wave's ticket is a page with
its alert and logs, the incident really happens, and before deploying you
**name the root cause** from a few plausible ones: right gives Trust back and
points, wrong costs Trust, and every answer explains why. Then you fix it on
the board, and the next page tests whether the fix holds.

**Legacy rescue** (Monolith) is about change without downtime: put a gateway in
front of a ten-year-old monolith, move one use case at a time to new app
servers (an app server's settings say which use cases it handles), split a
table out with a migration, and retire the old endpoint once its clients are
gone. A big-bang rewrite locks writes and breaks the old readers.

**Cost crunch** (Runway) is about spending less without breaking anything:
finance lowers a `cost <= … usd/month` requirement every wave while the SLOs
stay. Remove what is idle, right-size what is over-built, keep the cache that
spares the database, and keep two of everything for the failure drills.

## How the game uses the simulation

The board is a graph of components and wires, but the simulation reads
**use cases**: sequences of steps. The engine (`frontend/src/game/engine/`)
compiles the board and the scenario's use cases to Proschi source, which the
ordinary parser reads and the ordinary simulation analyses, once per tick:

- A use case enters at **Users**, passes the edge components it is wired
  through (load balancer, firewall, CDN, gateway) on the shortest path, and
  reaches the first **app server** that handles it.
- Each step runs from that app server: `read db` goes to the first database
  it is wired to, `call push` to the external system with that id.
- With a **cache** wired to the app server and a `cache` hit ratio, reads go
  cache-aside: "Cache hit", "Cache miss" (which fills the cache) and
  "Cache down" (a fallback, so the cache does not count against
  availability, but a failed call costs its timeout).
- With a **CDN** on the path and an `edge` hit ratio, an "Edge hit" scenario
  ends at the CDN.
- Steps marked `async` go through a **queue** and a **worker** when the app
  server is wired to a queue whose worker reaches their targets. The request
  only publishes; the worker's work is a separate "(background)" use case, and
  a worker that cannot keep up builds a backlog (in minutes) instead of
  slowing the request. Without a queue, async steps run on the request.
- **Far users** (a wave's `global` share) cross an ocean: 120 ms on the
  request, except for CDN edge hits, which are answered nearby.

Sizes, cards and incidents become `capacity` overrides; requirements are the
scenario's Proschi lines, checked with `runTests`. "Open in editor" on the
end-of-run report opens the compiled design. What the game adds on top of the
simulation, and approximates:

| Game rule | How it works |
|---|---|
| Dropped requests | A request is served with probability `min(1, 1 / utilisation)` at every node on its path. |
| Backlog | Each tick adds `60 × (utilisation − 1)` minutes of lag at the busiest background node, and drains the same way below 100%. |
| Availability zones | Three zones; an outage takes a third of every component's replicas (rounded up). A single instance goes down with it. |
| Failover | A SQL database's writes stop for the first tick while a replica is promoted; with shards, only one shard's share. Without a replica, it is down. |
| Hot key | Caches and databases lose that share of their read capacity. |
| Bots | Extra traffic on random keys; a firewall (403) or gateway (429) stops it at the edge. |

## The content folder

```text
frontend/src/game/content/
  components.json        placeable components and unlockable features
  perks.json             permanent perks
  ids.lock               every id ever published (never remove a line)
  cards/<id>.md          tech cards for the draft
  events/<id>.md         incidents and spikes
  scenarios/<id>/
    scenario.md          title, summary, prose: briefing, acts, debriefs, interview translation
    scenario.json        start board, use cases, waves, event pool, contracts
    reference.json       a scripted run that must clear all 12 waves
    wrong/<name>.json    scripted runs that must fail by a given wave
```

### scenario.md

Front matter (the same strict subset of YAML as problems and cards: flat
keys, one-line lists, quote values with `: ` in them):

| Field | |
|---|---|
| `title`, `summary` | What the scenario picker shows. |
| `difficulty` | `easy`, `medium` or `hard`. |
| `tags` | Free words for the picker. |
| `related` | Practice problem ids, linked from the end-of-run report. |
| `cards` | Review card ids the report suggests. |
| `order` | Position in the picker. |
| `version` | Bump it when a change can change a score: it starts a new leaderboard season for the scenario. |
| `mode` | `scale` (the default), `startup`, `incident`, `legacy` or `cost`. Every mode but `scale` has no card draft and gives every wave a ticket, and may have 4 to 12 waves. |

Sections: `## Briefing` (required), `## Act 1` to `## Act 3` (shown at the
start of each act), `## Debrief: <id>` (shown after a wave whose `debrief`
names it), `## Ticket: <id>` (the text of a wave's ticket), and
`## Interview translation` (required): the design in the words you would use
in an interview.

### scenario.json

```json
{
  "start": { "cash": 3000, "trust": 100, "board": { "nodes": [ … ], "edges": [ … ] } },
  "grants": ["storage"],
  "externals": [{ "id": "push", "name": "Push provider", "tech": "Push Service", "rps": 30000, "latencyMs": 60 }],
  "useCases": { "redirect": { … } },
  "waves": [ … twelve … ],
  "eventPool": [{ "id": "noisy-neighbor", "weight": 3 }],
  "contracts": [ … ],
  "unlock": { "scenario": "shortly", "wave": 6 }
}
```

- **start.board** has a `users` node, every external, and only components
  unlocked from the first run or granted.
- **grants** lends components for this scenario's runs whether the player
  unlocked them or not: the ones its lesson is about.
- **externals** are systems you call but do not run: a catalog tech of the
  external kind, with optional `rps` and `latencyMs`.
- **unlock**: reach this wave in that scenario to open this one. Leave it out
  for a scenario open from the start.

A **use case**:

```json
"redirect": {
  "name": "Redirect",
  "method": "GET",
  "path": "/aZ3x9",
  "status": 302,
  "value": 250,
  "size": "500B",
  "steps": [{ "op": "read", "to": "db", "entity": "Url" }],
  "cache": 0.9,
  "edge": 0.85
}
```

| Field | |
|---|---|
| `name` | The Proschi use case name; requirement lines refer to it. No quotes or brackets. |
| `method`, `path`, `status` | The entry request and its answer. |
| `value` | Revenue per wave for every 1 000 rps that succeed. |
| `size` | Payload between the user and your edge: the upload for a POST, the response for a GET. It fills bandwidth, and responses to users are billed as egress (less from a CDN). |
| `steps` | In order: `{"op": "read" \| "write", "to": "db" \| "blob" \| "search" \| "warehouse"}` or `{"op": "call", "to": "<external id>"}`, with optional `entity`, `async` (may run in a worker), `x` (fan-out) and `size`. |
| `cache`, `edge` | Hit ratios (0 to 0.99) when a cache or CDN is in place; leave out for data that cannot be cached. |
| `strong` | Reads must see the latest write: no cache, and an eventually consistent store is a breach. |
| `optional` | Contracts and extras: a missing route costs less Trust. |

A **wave**:

| Field | |
|---|---|
| `traffic` | Base rps per use case key. Once a use case appears, every later wave gives its rps. |
| `curve` | `flat`, `day`, `ramp`, `spike` (×4 for two ticks) or `double-peak`. |
| `requirements` | Proschi requirement lines, each naming a use case: `p99 "Redirect" < 50ms`, `availability "Checkout" >= 99.9%`, `durable "Shorten"`, `survive any node failure`, `cost <= 4000 usd/month`. A line for the same measure and use case replaces the earlier one. |
| `freshness` | `[{"useCase": "send", "maxMinutes": 5}]`: how far background work may lag. |
| `events` | Event ids that happen this wave, telegraphed. |
| `contract` | Offer three contracts after this wave. |
| `global` | Share of far users from this wave on. |
| `boss`, `name` | Waves 4, 8 and 12 are bosses. |
| `debrief` | A `## Debrief: <id>` section shown after the wave. |

From wave 3, one incident a wave is also drawn from the **eventPool**
(weighted, never the one drawn the wave before, and no spikes on a boss).
A **contract** has an `id`, `name` and `text`, and any of: `useCase` with
`rps` and `growth` (it adds that use case), `requirements`, `freshness`,
`cash`, `revenue` (a multiplier on every use case).

### Cards

```markdown
---
name: Connection pooling
icon: cable
rarity: common
topic: databases
learn: [connection-pooler, connection-pool-size]
effect: capacity
target: db
stat: rps
value: 1.2
---

## Text

Databases take 20% more reads and writes.

## Why

Every database connection costs the server memory…
```

`icon` is required: a kebab-case [lucide](https://lucide.dev/icons/) name
listed in `frontend/src/game/engine/icons.ts` (see [Icons](#icons)), and no
other card may use it; its tile takes the card's rarity colour. `rarity` is
common, uncommon, rare or legendary; `unlock` (Blueprints) makes a card
buyable instead of in the pool from the start. `learn` lists review card
ids. The `effect` is one the engine implements:

| Effect | `target` / `value` |
|---|---|
| `capacity` | Component id or role, `stat` rps, reads or writes; multiplier. |
| `latency`, `cost` | Component id or role; multiplier. |
| `cache-hit`, `edge-hit` | Added to every hit ratio. |
| `timeout` | What a failed call costs, in ms. |
| `coalesce` | Cold caches and stampedes do nothing. |
| `autoscale` | App servers and workers resize every tick. |
| `write-batching` | Share of background messages that write. |
| `payload` | Multiplier on every payload. |
| `presigned` | Uploads go straight to object storage. |
| `hot-key` | Multiplier on the hot-key penalty. |
| `failover` | No write outage while a SQL replica is promoted. |
| `reserved`, `spot` | Cost multiplier on app servers (no scaling below today's for 3 waves) or workers (they lose a replica in any incident). |
| `trust`, `cash`, `interest`, `oncall`, `loadtest`, `streak` | Paid once, or a per-wave allowance. |

### Events

```markdown
---
title: Cache stampede
icon: snowflake
category: incident
topic: caching
learn: [cache-stampede, cold-cache-restart]
effect: cache-cold
target: cache
values: ["0", "0.5"]
duration: 2
telegraph: The cache cluster restarts for a version upgrade.
counters: [request-coalescing]
requires: [cache]
min-wave: 4
---

## What happened
## Why
## What a senior engineer would do
```

Effects: `traffic` (multiplier), `write-surge` (multiplier on the use cases
that write, or `target: async` for those with background work), `bots`
(multiplier of real traffic), `az-down`, `node-down` (the first component
matching `target`), `failover` (a SQL database), `cache-cold` (`values` per
tick, a share of the usual hit ratio), `latency` (multiplier), `hot-key`
(share), `external-slow` (latency in ms; `target` an external id or none for
all). `from` fixes the first tick; otherwise the seed picks it. `requires`
lists roles the board must have for the pool to draw the event. `icon` is
required, as for cards, and unique among the events; its tile is red for an
incident and pink for a spike. All three sections are required: they are the
debrief.

### perks.json

```json
{ "id": "seed-round", "icon": "piggy-bank", "name": "Bigger seed round", "text": "Start every run with $250 more per level.", "costs": [6, 10, 14], "effect": "cash", "value": 250 }
```

`costs` are the Blueprints for each level, `value` is the effect per level,
and `effect` is one of `cash`, `trust`, `free-reroll`, `starter-card`,
`loadtest` or `oncall`. `icon` is required and unique among the perks.

### Icons

Perks, cards and events each have an icon of their own: an icon may appear
once among the perks, once among the cards and once among the events, but
not twice in one of them. The names are lucide's, listed in
`frontend/src/game/engine/icons.ts` (no React, so `proschi game check` can
read it) and mapped to their components in
`frontend/src/game/ui/gameIcons.tsx`. To use a new icon, add its name to
both; the frontend tests fail if the two lists differ.

### Tickets, versions and migrations

A wave's **ticket**: `"ticket": {"id": "multi-pet", "from": "pm", "kind": "schema", "title": "Multi-pet bookings"}`.
`from` is `pm`, `cto`, `customer`, `legal`, `finance`, `sre` or `marketing`;
`kind` picks its icon (`feature`, `scale`, `compliance`, `mobile`, `region`,
`api-version`, `schema`, `data-move`, `deprecation`, `security`, `cost`,
`incident`, `reliability`, `analytics`, `performance`). Its text is the
`## Ticket: <id>` section.

An old **API version** is a use case with `"legacy": {"upkeep": 400, "replacedBy": "book-v2"}`.

A **migration**, in `"migrations"`:

```json
{
  "id": "pets",
  "name": "the multi-pet migration",
  "entity": "Booking",
  "store": "db",
  "needs": ["book-v2"],
  "writers": ["book", "book-v2"],
  "oldReaders": ["book"],
  "backfillRps": 900
}
```

`needs` are served only from the cutover, `writers` write twice from the dual
write to the contract, and `oldReaders` break once the old shape is dropped.

An on-call wave's **diagnosis**: a `question` and `options`, each with an
`id`, `text` and `why`, exactly one of them `"correct": true`. A play picks
one with `"diagnose": "<id>"` (the first option when it says nothing).

## Reference and wrong runs

Every scenario ships with scripted runs, like a problem's reference solution
and wrong designs. A run is a seed, an optional loadout and ascension, and a
**play** per wave:

```json
{
  "seed": "reference",
  "loadout": { "unlocked": ["cache", "cdn", "tiers"], "perks": {} },
  "plays": [
    {},
    {
      "add": [{ "id": "lb", "component": "lb", "replicas": 2 }],
      "set": { "api": { "replicas": 3 } },
      "unwire": [["users", "api"]],
      "wire": [["users", "lb"], ["lb", "api"]],
      "pick": ["async-io", "right-sizing"],
      "contract": "angel"
    }
  ],
  "expect": { "cleared": true }
}
```

A play changes the board deployed last wave (`add`, `remove`, `set`, `wire`,
`unwire`), may `loadtest`, page the `oncall` (`[{"tick": 3, "node": "api"}]`),
`reroll`, `pick` the first card on offer from a list, sign a `contract`,
`migrate` (`[{"id": "pets", "to": "next"}]`; `to` is `next`, `rollback` or
`big-bang`) and `sunset` legacy use cases (`["book"]`).
Waves past the list keep the board and skip every choice.

- `reference.json` must clear all twelve waves (`"expect": {"cleared": true}`).
- Each `wrong/<name>.json` is a plausible design that must lose by a wave
  (`"expect": {"failsBy": 8}`): no cache, no CDN, a provider called inline.
  It may also name the breaches it must show (`"shows": ["compat"]`), or
  only those, for a mistake the run survives. Add a `note` saying what it
  shows.
- The check also plays "do nothing" (the start board, every wave), which must
  lose by wave 8 (or the wave before the last, in a shorter scenario).

## Balancing

```sh
cd tooling
npm run build
node dist/cli.cjs game sim shortly                 # the reference run, wave by wave
node dist/cli.cjs game sim shortly --seed other    # the same plays with other incidents
node dist/cli.cjs game sim shortly --run my.json --ascension 5
```

`sim` prints each wave's cost, revenue, points, Trust and what broke. Good
scenarios:

- teach one new idea per wave, and make each act's last wave a boss;
- break last wave's design every two or three waves (traffic about ×1.5 a
  wave), so there is always something to do;
- burn cash early and turn a profit once the design is right (a hockey
  stick), with no single build that wins every scenario;
- keep requirements achievable: a dependency at 99.9% caps the use cases that
  call it, and far users cannot have a 50 ms p99 without a CDN hit.

## Checks

```sh
node tooling/dist/cli.cjs game check     # everything below; exits 1 on any violation
node tooling/dist/cli.cjs game lock      # adds new ids to ids.lock
```

`game check` reads every file and checks: fields and their values, ids in
`ids.lock` (and none removed), review cards, topics and practice problems
that exist, card and event targets, icons (known, and unique among the
perks, the cards and the events), requirement lines that parse and name a
use case, traffic for every active use case, start boards the first run
allows, and the scripted runs. The frontend tests run the same check.

## Checklist

1. Write `scenario.md` and `scenario.json` (copy a scenario close to yours).
2. Write `reference.json` and at least one `wrong/*.json`; tune with
   `game sim` until the reference clears with some margin and the wrong runs
   lose for the reason in their note.
3. New cards or events: one file each, with `learn` cards and all sections.
4. `node tooling/dist/cli.cjs game lock`, then `game check`.
5. `npm test` in `frontend/` and `tooling/`.
6. Add the change to `CHANGELOG.md` under `[Unreleased]`.
