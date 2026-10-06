# Changelog

All notable changes to Proschi are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the tooling
(the `proschi` npm package and the VS Code extension) follows
[Semantic Versioning](https://semver.org/). Versions are tagged
`tooling-v<version>`; the web app at <https://gvart.github.io/proschi/> is
deployed from `main` and ships with the same changes.

## [Unreleased]

### Added
- **Import from Mermaid and OpenAPI.** *Diagrams › Import Mermaid or
  OpenAPI…* turns a Mermaid flowchart or sequence diagram (or Markdown with
  several ```` ```mermaid ```` blocks) into a Proschi document: shapes and
  labels become kinds, subgraphs groups, link labels connection labels, and
  messages, `alt` and `par` blocks a use case. An OpenAPI 3 spec (YAML or
  JSON) becomes a starter design with a use case per operation. Paste or pick
  a file, check the preview and its warnings, open it as a new diagram. The
  CLI has the same: `proschi import mermaid|openapi <file>`.
- **Start from…** The editor's examples gallery is searchable and filtered by
  pattern (cache, queue, CDN, fan-out, sharding, replication, rate limiting…),
  with tags derived from each design. It also offers the reference solution of
  every practice problem you have solved; the others are listed as "Solve …
  to unlock", linking to the problem.
- **Hold the line**: in the Arcade a wave's run is no longer something you
  watch. Change the board while it runs and ship it live: scaling lands the
  next tick, new components and wires in two, and a cache that goes live
  mid-wave starts cold. Three live changes a wave, next to the on-call's
  instant (and dearer) actions. Works on a phone: the dock swaps the on-call
  menu for the palette.
- **Scale or Fail is less of a solved puzzle.**
  - **Forecasts are now ranges.** The real traffic lands within 12% of the forecast (20% on a boss), so a load test tests the middle and headroom is a choice.
  - **Some incidents come unannounced** from wave 5.
  - **Incidents can cascade.** One that broke something badly sets off the next (at most one a wave): a lost cache node comes back cold, a stampede knocks the database over, a dead primary brings a storm of retries.
  - **The on-call has a menu**, paid in three points of attention a wave: one more replica, bring a lost node back, warm the cache, rate-limit at the edge, or switch a feature off.
  - **Each wave offers three bounties.** Take one or none; missing it costs a quarter of its cash.
  - **Six new cards bend a rule for a price.** Kubernetes autoscales at 25% more per app server, and Skip staging pays $600 and costs Trust.
  - **Three cards of one topic make a set:** points ×1.1.
  - **A right-sized wave refunds** a tenth of its bill.
  - New leaderboards start with this version.
- **The Arcade teaches Proschi as you play.** The code pane opens in steps:
  in Shortly it first watches the board, lighting up the line each change
  writes, and lets you type from wave 3; in Drop, act 3 is typed only (on a
  wide screen). Completion inside `[ ]` offers only the components you can
  place, Users and the externals cannot be typed away, and a burst of typing
  is one undo step. A new **Compiled** tab shows the whole document the
  simulation runs (your board, the use cases, the peak traffic and the
  requirements), with a warning on every line that broke after a load test
  or during the run. Which use cases an app server handles can be typed as
  `# handles: book, pay`, and a **Code only** button in a run's header lets
  you type every scenario. "Open in editor" now keeps instance sizes.
- **Favicon fallbacks**: a `favicon.ico` for browsers and search results
  that skip SVG icons, and an Apple touch icon for home screens.
- **Mutators and bounties** in Scale or Fail, so no two runs want the same
  design. A run starts with a choice of three mutators: users on another
  continent, a dearer SQL licence, a read storm, a write-heavy crowd, a
  flaky zone, a lean seed round or a cache vendor in trouble. Each changes
  the design that wins and multiplies your points (×1.1 to ×1.3). Every wave
  also has an optional bounty, such as keeping app servers under 50%,
  keeping the bill under 40% of revenue, or getting through a boss without
  dropping a request. Met, it pays cash at once and points. Kernel mentions
  both, the debrief and the report count them, and the daily run offers
  everyone the same ones. New leaderboards start with this version.
- **Kernel**, the Arcade's cat SRE lead: at the start of every wave it briefs
  you in a speech bubble that types itself out. It says how traffic changed
  since last month, which use cases go live, and the new requirements in
  plain words ("Redirect must answer in under 200 ms for 99% of requests"),
  plus the incidents coming. Boss waves open with their own intro and a
  worried cat. Tap to show it all, "Got it" to put it away, and the cat
  button in the run's header turns briefings off.
- **Legacy rescue** and **Cost crunch**, the last two design-first Arcade
  modes. **Monolith** (8 waves): strangle a ten-year-old shop's monolith
  behind a gateway, extract search and a catalog API, split the orders table
  with expand and contract, and retire the XML export once partners stop
  calling it. **Runway** (7 waves): an over-built startup must halve its
  cloud bill while keeping its SLA, a failover and a zone drill.
- **On-call**, a design-first Arcade mode, and its scenario **Dinnerbell**:
  five pages for a food-delivery app (a TV-ad spike, a dead database primary,
  a bot flood, a cold cache, a lost zone), each with its alert and logs. Name
  the root cause before you act (every answer explains why it is right or
  wrong), then fix it on the board.
- **Chaotic Startup**, a design-first Arcade mode, and its first scenario,
  **Pawprint**: a pet-sitter startup where a ticket lands every wave (a
  feature, a customer complaint, a lawyer, a launch). Ship booking API v2 next
  to v1 and sunset v1 only once its clients are gone; change the schema by
  expand and contract, one phase a wave (expand, dual-write, backfill,
  cutover, contract), with rollback, or all at once and watch writes lock.
  No card draft: the design is the game. Two review cards join the deck:
  expand-and-contract migrations and online backfills.
- **Scale or Fail on the editor's canvas.** The Arcade's board is drawn with
  the editor's nodes, icons and connections, with the simulation overlay
  (heat, stacked replicas, load bars, request particles); drag from a node's
  bottom dot to another to wire them. A **Code** tab shows the board as
  Proschi text you can edit instead of tapping.
- **`size S|M|L`** in `capacity` blocks: an instance size that scales a
  tech's default capacity (×1, ×2, ×4) and cost (×1, ×1.8, ×3.5); an explicit
  rate or cost wins. The editor's settings panel has an **Instance size**
  picker. The Arcade's sizes are the same numbers.
- **Overlay: load** on the editor's canvas, for documents with a `traffic`
  block: each node heats up from paper to yellow, pink and red with how busy
  it is, shows its replicas (stacked), shards and load, shakes past 100%,
  and requests flow along the connections as dots (hollow for async work).
  The Arcade will draw its board the same way.
- **Build diagrams without typing.** The editor's canvas has an **Add
  component** palette (search the catalog, click to add or drag onto the
  canvas) and a settings panel for the selected node or connection: name,
  tech, replicas, owner, description, capacity, latency, availability, cost,
  shards and connection labels. Every change is written into the text, which
  stays the source of truth, touching only the part of the line it changes.
  `proschi parse` output gains `blocks`: where each section block starts and
  ends.
- **Scale or Fail**: every perk, tech card and incident has its own icon, on
  a tile coloured by the card's rarity or the event's kind (incident or
  spike): in the draft, your hand, the shop, your equipped perks, the
  forecast, the debrief, breach callouts and the end-of-run timeline. Content
  names it with an `icon` field, and `proschi game check` rejects an unknown
  icon or one used twice among the perks, the cards or the events.
- **Scale or Fail** is playable: the Arcade tab of Interview prep
  (`practice/#/arcade`). Pick a scenario and build its system by tapping or
  dragging components onto the board (they wire themselves sensibly; tap a
  node to scale it out, size it up, shard it, rewire or remove it), read the
  forecast, load test, deploy, and watch eight ticks of traffic flow as
  particles while nodes heat up and break. Page the on-call mid-wave, then
  read the debrief (what happened, why, what a senior engineer would do, and
  the review cards that explain it), draft a tech card and take contracts.
  Runs earn Blueprints for new components, rare cards and perks; scenarios
  and difficulty levels open as you go; there is a daily run and, signed in,
  leaderboards. The report shows your worst mistakes, the design in interview
  words, and opens your final design in the editor. Optional sound. Four game
  badges join the achievements, and game lessons add a small bonus to the
  skill map's topics.
- The engine and content of **Scale or Fail**, a system design roguelite for
  the Interview prep page: pick a scenario (a URL shortener, a photo app, a
  notification service, a flash sale), place and wire components, and keep
  the system up for twelve waves of growing traffic, new use cases, stricter
  requirements and incidents (zone outages, cache stampedes, failovers, hot
  keys, bot floods). Every tick runs Proschi's simulation on the board, so
  every failure comes with the bottleneck and the fix. Runs are seeded and
  replayable, so the server can check a score. Scenarios, tech cards and
  incidents are plain files in `frontend/src/game/content/`
  ([docs/GAME.md](docs/GAME.md)); `proschi game check` validates them and
  plays every scenario's reference and wrong runs, `proschi game lock`
  records new ids, and `proschi game sim` prints a run wave by wave for
  balancing.
- Scale or Fail on the server (`/api/game/*`, backend/README.md): ranked
  runs are started by the server, which picks the seed and the loadout from
  your stored progress, and scored only by replaying their moves with the
  same engine. Leaderboards per scenario and difficulty and for the daily
  run, purchases of unlocks and perks, and runs played signed out carried
  over when you sign in. Your game progress and runs are in the data export.
- `analyze()` takes the percentiles to compute, and `runTests()` the options
  the analysis was made with (so `survive` re-analyses the same way). A
  latency quantile without parallel steps is computed in closed form, which
  makes analysing a design several times faster.
- `CONTRIBUTING.md`: how to set up, the checks before a pull request, and
  step-by-step guides to adding a practice problem and a review card. The
  practice list ends with "Have a system design problem in mind? Contribute
  it", with a link to suggest an idea instead, and the footer links to the
  guide. New issue templates suggest a problem or a card without writing
  code.
- Interview prep is a hub (`practice/#/roadmap`, "Interview prep" in the
  header) with tabs for the roadmap, daily review, the daily challenge and
  your progress, and your streak and today's goal at the top. The old
  addresses (`#/review`, `#/review/<topic>`, `#/challenge`, `#/progress`,
  `#/roadmap/<id>`) open inside it. The
  Practice list is now just the problems, with one small link to interview
  prep.
- Your profile page (`practice/#/me`, "Your profile" in the account menu):
  your streak, freezes and daily goal, your daily challenge streak and best
  score, problems solved by difficulty, cards reviewed and mastered, the interview-ready score, the skill map, every
  badge and the problems you solved, and the public profile setting. Badges
  are a compact grid of small medals, here and on the progress page; tap one
  for what it is and how far along you are.
- Public profiles (`practice/#/u/<id>`), linked from the leaderboard and
  the daily challenge's leaderboard, for users who opt in: name, month
  joined, problems solved, streaks, the daily challenge streak and best
  score, readiness, topic mastery and badges, never designs, review history
  or challenge answers
  (`GET /api/users/<id>/profile`; docs/PRIVACY.md lists exactly what is
  shown).
- 258 practice cards for daily review, from estimation and networking to
  consistency, streaming and probabilistic data structures: one Markdown file
  per card in `frontend/src/practice/cards/<topic>/<id>.md`, as flip,
  multiple-choice, estimate or fill-in-the-gap cards in 15 topics, with a
  32-card sample deck. `proschi cards check` validates them (fields,
  ids that are never deleted or reused, topics, related problems, phone-sized
  text and near-duplicate cards) and `proschi cards lock` records new ids.
  How to write them: `docs/CARDS.md`.
- Daily review on the practice page (`practice/#/review`): a few minutes of
  cards a day, each scheduled to come back just before you would forget it
  (FSRS). Recall a concept and rate yourself, pick an option, estimate a
  number (typed as `2300`, `2.3k` or `1e6`) or fill a gap, with the reasoning
  shown after each answer. Train one topic, or take the day's due and new
  cards; keyboard shortcuts (space to flip, 1–4 to rate) and phone-sized
  buttons. Signed in, every card is reviewed and your reviews are kept in
  your account, even when sent later from a phone that was offline; signed
  out, try the free sample deck. Find it from the "Daily review" card on the
  practice list or in the footer. The cards are also published as
  `practice/cards.json` for apps.
- A daily goal and streak: review 10 cards (or pick 5, 20 or 30) or solve a
  problem each day to keep your streak going. The flame, a ring filling up
  toward today's goal and your streak freezes show on the review page and the
  practice list; every 7 days in a row earn a freeze (up to 2) that covers a
  missed day for you. Signed in, your account keeps the streak, so every
  device shows the same one.
- Celebrations: a summary with a little confetti when a review session ends,
  marking the daily goal and streaks of 3, 7, 14, 30, 50 and 100 days; on a
  problem's first solve, the runs it took and your design's cost and p99 next
  to the reference solution's, with links to the next roadmap problem and the
  cards that train for it; a moment when you finish a roadmap stage; and a
  weekly recap of last week's cards, solves and goal days on the review page.
  With reduced motion set, there is no animation, just the summary.
- A progress page on the practice page (`practice/#/progress`): a skill map
  that scores how well you know each of the 15 topics, from the cards you
  remember, how many of them you have seen, the related problems you solved
  and, for estimation, how often your numbers land; an "interview ready"
  score; and your three weakest topics, each with a "Train this topic"
  button. Plus 32 badges in bronze, silver and gold for reviewing, streaks,
  mastered cards, solving problems (hard ones, on the first run, or cheaper
  than the reference solution), estimating and finishing roadmap stages,
  each locked one with a progress bar; the streak badges count your daily
  streak, so your goal, solves and freezes count. A new badge pops up once
  when you earn it, after a session's summary has had its moment. Signed
  in, your badges are kept in your account and included in "Download my
  data"; on a copy of the site without accounts they are kept
  in the browser. Find it from the daily review page or the progress strip
  on the practice list. `proschi achievements check` validates the badges'
  definitions, and `proschi achievements lock` records new ids in
  `achievements.lock`, so a badge's id is never deleted or reused (a badge is
  retired with `"retired": true` instead).
- A daily challenge (`practice/#/challenge`): five cards a day, the same for
  everyone and new at 00:00 UTC, mixing topics and difficulties with at least
  one estimate. Each right answer scores 100 points plus up to 20 for
  answering within 10 seconds (fading to nothing at a minute), for at most
  600. Signed in, the server grades your answers, keeps your first attempt
  and ranks it on today's leaderboard (top 20 of those who chose to appear on
  it); signed out, play and see your score, then sign in to save it. The
  result shows each right answer with why, your rank, a challenge streak and
  a "Copy result" button for sharing, e.g. `Proschi daily challenge
  2026-10-06: 480/600 ✅✅❌✅✅`, and a perfect score gets confetti. Every
  answer also counts as a review toward your daily goal, and a reload in the
  middle carries on at the next card. Three new badges:
  a first challenge, a perfect score and a 7-day challenge streak. Find it
  as the Challenge tab of interview prep, or in the footer.
- Sign-in for native apps, ready for a future mobile app: an app signs in
  with GitHub or Google in the system browser
  (`/auth/<provider>/start?client=app`, OAuth 2 with PKCE, back to an
  allow-listed `APP_REDIRECT_URIS` address with a one-time code), exchanges
  the code at `POST /auth/token` for an hour-long access token and a 60-day
  refresh token that rotates on every use (a reused one signs that app out),
  and calls every `/api` endpoint with `Authorization: Bearer`.
  `POST /auth/revoke` signs an app out; "Sign out everywhere" and deleting
  the account include apps, and "Download my data" lists each session with
  its kind. The site keeps its cookie as before. How it works:
  `backend/README.md`, "Mobile apps".
- "Numbers to know" in the docs (`docs/numbers/`): a cheat sheet of the
  round numbers system design runs on (latency, throughput and connections
  per server, disk and network speeds, time and size conversions,
  availability nines, object sizes and approximate cloud prices) with a
  fully worked estimate, and how Proschi's simulation defaults compare.
  Every estimate card and the interview guide link to the section they use.

### Changed
- The Arcade shop shows an icon and a one-line description for every item:
  components with the icon the board draws for them, features with their
  own. Each tab (Components, Features, Rare cards, Perks) says what it sells,
  under the tabs and as a tooltip.
- The practice list's filters take one row on a phone: a search box and a
  "Filters" button that shows how many are on (for example "Filters · 2").
  It opens the difficulty, tag, company and status filters; Escape closes
  them. The filters in use show as chips under the search, each with an ×
  to remove it, and "Clear all".
- Signed in, reviews not sent to your account yet (made offline, say) now
  count toward the streak and today's goal on the daily review page and the
  practice list right away, as they already did in a session's summary. Once
  sent, they count once.

### Fixed
- On phones, the on-screen keyboard no longer covers the field you are
  typing in.
- Diagram selection actions no longer run under the Export and load buttons
  on narrow screens: Delete is in the settings card's header, and with the
  card closed or several items selected, Rename and Delete show in a bar at
  the bottom of the diagram.
- Arcade: a run, and each new wave, opens at the top of the page instead of
  wherever the scenario list or the draft was scrolled to.
- Daily review on a phone: after you answer a card, the next one scrolls
  into view with its topic, type and question below the site header, and
  keyboard focus moves to its heading. Showing an answer brings it into view
  without scrolling the question away. Scrolling is instant when your device
  asks for reduced motion.
- On the interview prep roadmap, a locked step's "Read the lesson" is locked
  too, with a lock and what opens it ("Solve URL Shortener first", or sign
  in). Opening a locked step's address (`#/roadmap/<id>` or
  `#/roadmap/<id>/lesson`) shows the roadmap with that message instead of
  the step. The "Read first" guide, and lessons opened from the problem
  list, stay open to everyone.
- On phones the header fits the screen on the practice pages: with the
  account and help menus it no longer pushes the menu button off screen or
  makes the page scroll sideways (the "Open the editor" button, also in the
  menu, waits for wider screens, and below 380px the logo keeps its tile
  only). The account, help and editor menus open inside the screen, spanning
  it on phones, and a long display name is shortened in the header. The
  editor's toolbar wraps instead of overflowing between 640 and 700px.
- The practice problems' statements and lessons, and the interview approach
  guide, are clearer and more accurate: plainer English with shorter
  sentences, jargon explained where it first appears, estimates that match
  the problem files (for example the payments budget, Pastebin's egress
  ratio, notification fan-out's SMS share and the ride-matching shard cost),
  and "Common mistakes" sections that name every check each wrong design
  fails.

## [0.8.0] - 2026-10-05

### Changed
- The site moves to <https://proschi.app/>, served by a Cloudflare Worker
  (`backend/`) together with its API. The old address,
  `gvart.github.io/proschi/`, redirects every page and share link to the same
  path on proschi.app.
- Interview prep is easier to find: a section right under the landing page's
  hero with the roadmap's stages, an "Interview prep" link in the header, and
  a roadmap card with your progress at the top of the practice list. Pages no
  longer scroll sideways on phones (the landing page's "How it works" cards,
  the simulation docs' formulas and tables, the problem pages' big button).

### Added
- An interview prep roadmap in practice (`practice/#/roadmap`): the problems
  in eight stages, from foundations through caching, partitioning, queues,
  fan-out, streams and consistency to large systems, each with a note on what
  it teaches. A problem on the roadmap opens once every problem before it is
  solved, with your progress, the current stage and a Continue button; a
  problem opened from the roadmap links to the next one after a solve. Anyone
  can see the roadmap; starting it takes signing in. The problem list stays
  open.
- Practice problems based on a published system name its company: an
  optional `company` field in problem.md (docs/PRACTICE.md), set on Snowflake
  IDs (Twitter), Shopping Cart (Amazon), Job Queue (Slack), View Counting
  (Reddit) and Social Graph Cache (Meta). The problem list shows it as a
  badge and filters by it, and the problem page and its static page show the
  badge. It says where the design comes from, not that the company asks the
  problem in interviews.
- An "AI review" view next to the tests on the practice page, with a "Review
  my design" button. It is a placeholder for now: it says the review is
  coming soon and gives no feedback. The request it will send (the design,
  its parsed model, test results, and cost, p99 and availability from the
  simulation) and the review it expects are defined in
  `frontend/src/review/`, and the Worker has a stub `POST /api/review` that
  validates the request and answers 501 (backend/README.md). Builds with
  `VITE_AI_REVIEW=true` call it.
- Practice accounts and global stats, from the Worker's API and a D1
  database. Sign in with GitHub or Google from the practice
  header to keep progress and designs across devices; progress already in the
  browser is uploaded on first sign-in. The server re-runs a problem's tests
  with the same parser and simulation before it records a solve. The problem
  list shows each problem's solve rate, a solved problem shows how many
  solved it, the median number of test runs to solve it, and where your
  cheapest design's cost and fastest p99 fall among other solvers', and a
  leaderboard lists those who opt in under a display name they choose. No
  email address is stored; the session is an HttpOnly cookie on proschi.app,
  and the account menu deletes the account and its data. Builds without
  `VITE_ACCOUNTS=true` work as before, with progress in the browser only.
- A "page not found" page for any missing path on proschi.app, with the site
  header and links to the editor, practice and docs, in place of Cloudflare's
  default.
- The editor and practice show a "Something went wrong" screen, with a reload
  button and a link to file a GitHub issue (the error and the browser only,
  never your designs), when a page crashes, instead of a blank page.
- `robots.txt` and a `sitemap.xml` of the landing page, editor, practice,
  every problem's page and every docs page, generated at build time.
- Every practice problem has a page of its own, `practice/<id>/`, that search
  engines can index: the statement, difficulty and tags, a button that opens
  it in practice, and links to the other problems. The landing page's
  practice list links to these pages.
- Search and link previews: the editor and practice pages have descriptions,
  canonical URLs and Open Graph tags; docs pages get the preview image; the
  landing page and problem pages carry schema.org data (the app; each
  problem as a learning resource, with breadcrumbs). Page titles name what
  people search for: architecture diagrams as code, system design practice.
- Account controls in the practice account menu: link a second sign-in
  (GitHub and Google) to the same account and unlink one, sign out everywhere,
  and download everything the server stores about you as JSON. Sessions
  renew while in use and expired ones are purged daily.
- Problems have an optional `version` in their front matter (docs/PRACTICE.md),
  and the simulation a version of its own; global stats count only solves of
  the current versions, so a changed problem's stats start afresh.
- The API is hardened: rate limits on sign-in, account changes, uploads and
  stats; security headers and a request id on every response; structured
  logs without query strings; sign-in refuses to run without a strong
  session secret; display names that impersonate the site or contain slurs
  are refused; browser progress is uploaded in one request on sign-in. Every
  deploy goes to staging.proschi.app and passes a smoke test before
  production, which records a database bookmark to restore from.
- Five practice problems based on published systems, each naming its
  sources under *Based on*: Snowflake IDs (Twitter's id generator, easy),
  Always-writable Shopping Cart (Amazon's Dynamo, easy), Durable Job Queue
  (Slack's Kafka in front of Redis, medium), View Counting (Reddit's
  HyperLogLog pipeline, medium) and Social Graph Cache (Facebook's TAO,
  hard). Their scale and limits come from the posts and papers where these
  give numbers.
- Eight more problems based on published systems, each with its company:
  Discord Messages (Discord, hard), Notion Sharding (Notion, medium), Tiered
  CDN Cache (Cloudflare, medium), Replicated Git Storage (GitHub, medium),
  Push Gateway (Netflix, medium), Flash Sale (Shopify, hard), Metrics Ingest
  (Uber, hard) and Trending Topics (Twitter, medium). Twenty-five problems in
  all.
- A design review on the practice page (the "Review" view next to the tests,
  formerly the "AI review" placeholder) and in the editor's Analysis view.
  Worked out on the page from the simulation and the tests, it lists findings
  by severity (saturated nodes, single points of failure, latency,
  availability and cost against the requirements, failing tests, …), what
  the design does well and up to three next steps. An AI reviewer will come
  later behind the same interface.
- Lessons in practice: each roadmap step is now "Learn → Challenge →
  Review". A problem's optional `lesson.md` (docs/PRACTICE.md) explains the
  concepts behind it in eight fixed sections; a problem opened from the
  roadmap shows its lesson first with a table of contents and a "Start the
  challenge" button, remembers once it was read, and keeps it a tab away. The
  roadmap shows each step's reading time and opens with a "Read first"
  guide, *How to approach a system design interview*
  (`practice/#/roadmap/approach`, and `practice/approach/`). Lessons and the
  guide need no sign-in, and are part of the static problem pages and the
  sitemap. Statements and lessons understand tables, blockquotes and
  highlighted ```` ```proschi ```` blocks, and `proschi problem check`
  validates lessons.
- A lesson for every one of the 25 problems: the problem explained,
  back-of-the-envelope numbers, the concepts it needs, a step-by-step design,
  why each wrong design fails, what interviewers ask, and further reading
  (engineering posts and papers, the System Design Primer, awesome-scalability
  and the *System Design Interview* chapters by title).

### Security
- The static site sends HSTS and refuses to be framed (`X-Frame-Options`,
  `frame-ancestors`), along with `nosniff`, a referrer policy, a
  cross-origin opener policy and a permissions policy, from
  `frontend/public/_headers`. Hashed assets are cached for a year. The deploy
  smoke test checks these headers, the 404 page, the sitemap and robots.txt.

## [0.7.0] - 2026-10-04

### Added
- First-run onboarding. The editor opens with a five-step tour the first time
  (text → diagram, change a line, play a use case, Analysis/Tests, share and
  backup); most steps move on when you do the thing. Practice gets a three-step
  intro on the first problem. Tours are small non-modal popovers (Esc or X to
  skip, keyboard and screen reader friendly, reduced motion respected) and load
  only when shown. Shared diagrams and example links open without a tour, with
  at most a small corner hint. `?tour=1` / `?tour=0` force or suppress it.
- A Help (?) menu in the editor and practice headers: replay the tour, a syntax
  cheat-sheet (checked against the parser and docs/LANGUAGE.md in tests), the
  language reference and how the simulation works.
- An empty diagram offers a start: a template with the syntax in comments, an
  example, or practice. An example picked while the diagram is empty replaces it.
- A "How the simulation works" page at `/proschi/model/`: every rule the
  simulation uses (load from traffic, reads and writes, replicas, shards and
  single-primary writes, queueing, percentiles, fan-out and payloads,
  availability, cost, failures, kinds and consistency) with its default
  numbers, worked examples, the simplifications and omissions that make its
  numbers optimistic or pessimistic, how to calibrate `capacity` with your own
  measurements, and what a practice verdict means. A test recomputes every
  number on the page from the simulation code. Linked from the landing page,
  the editor's Analysis and Tests tabs and the practice test panel
  ("How is this calculated?").
- The tech catalog knows about 205 tech stacks instead of 110, with the names
  people write as aliases: `[S3]`, `[GCS]`, `[Azure Blob]`, `[MinIO]`,
  `[Postgres]`, `[CockroachDB]`, `[ScyllaDB]`, `[Valkey]`, `[Kinesis]`,
  `[Pub/Sub]`, `[OpenSearch]`, `[Fastly]`, `[ALB]`, `[nginx]`, `[Kong]`,
  `[Spring Boot]`, `[Go]`, `[Node.js]`, `[Kubernetes]`, `[Snowflake]`,
  `[ClickHouse]`, `[Stripe]`, … and a generic tech per kind (`[Service]`,
  `[Database]`, `[Message Queue]`, `[Object Storage]`, `[WAF]`, …). Matching
  ignores case, spaces, punctuation and a trailing version (`[PostgreSQL 16]`).
  The editor's and the language server's completion list the whole catalog and
  filter on aliases.
- The language server offers a quick fix for an unknown tech stack: replace it
  with the closest catalog tech.
- `capacity { db timeout 250ms }`: what a failed call (`-x`) to a node costs
  (1 000 ms by default).

### Changed
- An unknown tech stack no longer becomes a free, infinitely fast client. The
  node keeps the name you wrote and is simulated as the kind its name suggests
  (`[TigerBeetle DB]` is a database), else the kind of the closest catalog tech
  (`[Postgress]`), else a service. It is still a warning, so existing diagrams
  keep working, and the warning names the closest known tech.
- Latency percentiles: each hop is a fixed half of its service time plus an
  exponential tail for the rest of its mean, so the tail widens as a node fills
  up (an idle hop's p99 is 2.8× its mean). Timeouts and transfer time add once
  instead of being multiplied by the tail factor.
- A use case's percentile is now the percentile of its scenarios mixed by their
  shares, instead of one scenario's: it no longer jumps when a share crosses
  1 − q. With 10% cache misses, p99 is close to the miss path's p90.
- Queueing is M/M/c (Erlang C) over a shard's replicas, so large pools are no
  longer penalised; writes that bind a single-primary store queue for its one
  primary.
- `survive` analyses the design again with one instance fewer and also
  re-checks the latency requirements that held. On a sharded store it takes one
  replica from one shard, and a single-primary store fails over to a replica.
- Writes to a single-primary store depend on its primary: with a replica,
  failover loses a tenth of each outage (PostgreSQL with replicas: 99.995% for
  writes instead of 99.99999%).
- Egress is charged on payloads a node you run sends to clients and third
  parties: $0.09/GB from anything, $0.02/GB from a CDN. Services answering
  users now pay; storage answering your own services or a CDN no longer does.
- Nodes you run saturate on bandwidth as well as on requests; object storage
  and CDNs scale out. A fan-out of N moves N payloads.
- Failed calls (`-x`) add no load or egress to their target.
- The practice problems are recalibrated: latency limits set against the old,
  inflated tail are tightened to keep their margin over the reference
  solutions (chat, file storage, news feed, pastebin, rate limiter, ride
  matching, search autocomplete, ticket booking, URL shortener, video
  streaming), and the statements explain egress as data sent to users.

### Fixed
- On phones, switching back from Code to Diagram re-fits the diagram once the
  canvas has its real size again; it used to be fitted into a stale 500×500
  box and end up off centre or partly off screen. While a tour card is docked
  over the canvas, the diagram is fitted into the space above it.

## [0.6.0] - 2026-10-04

### Security
- Share links are decompressed with a 2 MB cap, so a crafted link can no longer
  freeze the tab.
- The parser and formatter are linear on adversarial input (unclosed payloads,
  deep `alt` nesting, now capped at 16, repeated connections); a fuzz suite
  guards this.
- `proschi render` always escapes labels in SVG/HTML output; HTML exports carry
  a strict Content-Security-Policy.
- Corrupt or crafted saved state, progress and imported file maps are
  validated, and `__proto__` keys are dropped.
- Content-Security-Policy and referrer-policy meta tags on every page.

### Added
- Diagrams menu: Export all (.zip) and Import backup, with merging.
- A notice with a download button when a share link is very long.
- Playwright browser tests in CI; the Pages deploy waits for them.
- Root README with a feature overview, links, quick start and contributing guide.
- This changelog.
- Dependabot for the frontend and tooling npm packages (weekly, minor and patch
  updates grouped) and for GitHub Actions (monthly).
- CI runs `proschi problem check` on the practice problems.

### Changed
- Diagram layout runs in a Web Worker and shows a provisional grid that glides
  into place.
- Smaller pages: the landing page loads without React, the practice list loads
  without the editor, and a problem loads only its own files.
  The editor panes load on demand.
- Workflows use the Node 24 majors of `actions/checkout`, `actions/setup-node`,
  `actions/upload-artifact`, `actions/upload-pages-artifact` and
  `actions/deploy-pages`.

### Removed
- The "Visual builder (classic)" drag-and-drop editor, its project list and its
  use case editor. The text editor covers everything it did.
- The unused Kotlin/Spring `backend/`; it is still in the history at
  `tooling-v0.5.0`.

## [0.5.0] - 2026-10-04

### Added
- `proschi problem check [dir]` validates practice problem folders: front
  matter, the solution passes, the starter fails, and every wrong design fails
  exactly the tests it names.
- `proschi problem new <id>` scaffolds a problem that already passes the check.

### Changed
- Practice problems are folders of plain files (`problem.md`, `given.proschi`,
  `starter.proschi`, `solution.proschi`, `wrong/*.proschi`) instead of
  TypeScript modules. The landing page builds its practice list from them.

### Fixed
- Capacity is set by the problem: `capacity` lines in a solver's design are an
  error and the simulation ignores them, so a solution can no longer claim
  unlimited throughput.

## [0.4.0] - 2026-10-04

### Added
- Language v2: precise assertions, selector unions, label prefixes, read/write
  access on steps and per-operation capacity keys.
- Simulation v2: separate reads and writes, shards, fan-out, egress and
  consistency, with new assertions for them.
- Twelve v2 practice problems: file storage, search autocomplete, ride matching,
  payments, ticket booking, video streaming, pastebin, rate limiter, URL
  shortener, chat, news feed and notification fan-out.

### Changed
- HLD documents and the CLI show reads and writes separately.

## [0.3.0] - 2026-10-04

### Added
- HLD language: traffic, requirements, replicas, capacity, entities, decisions
  and tests.
- Deterministic simulation: load, latency, availability and cost per node;
  Analysis and Tests panels in the editor; `proschi test` and `proschi analyze`.
- HLD documents: an HLD view in the editor and `proschi render --format
  hld-md|hld-html`.
- The system design practice platform at `/practice/`, with problems checked by
  tests in the browser, and a practice section on the landing page.

## [0.2.0] - 2026-10-03

### Added
- A warning for use case steps between nodes with no connection, path
  templates and scenario conditions (`when "…"`).
- Checking use case steps against OpenAPI 3.0/3.1 specs (`--openapi`,
  `proschi.json`), in `proschi check` and the language server.
- A formatter: `proschi fmt`, LSP formatting and Format in the web editor.
- Multi-file documents with `import`.
- Export: Mermaid, `proschi render` (SVG, Markdown, HTML) and a diagram preview
  in VS Code.
- A landing page and `when` completion.

### Changed
- Releasing the tooling can also be started by running the workflow on `main`.

## [0.1.0] - 2026-10-03

### Added
- The Proschi language: nodes, groups, connections and use cases with requests,
  responses, fire-and-forget calls, `par` blocks, `alt` scenarios and failed
  calls; endpoint grouping.
- The web editor: live text editing with auto-layout (elkjs), animated use case
  playback, share links, saved diagrams, PNG/SVG export, examples and canvas
  edits written back to the text. Runs fully in the browser on GitHub Pages.
- Tooling: the `proschi` CLI (`check`, `parse`), a language server, a TextMate
  grammar, a JSON Schema for the parsed diagram and a VS Code extension,
  released on tag push.

[Unreleased]: https://github.com/gvart/proschi/compare/tooling-v0.8.0...HEAD
[0.8.0]: https://github.com/gvart/proschi/compare/tooling-v0.7.0...tooling-v0.8.0
[0.7.0]: https://github.com/gvart/proschi/compare/tooling-v0.6.0...tooling-v0.7.0
[0.6.0]: https://github.com/gvart/proschi/compare/tooling-v0.5.0...tooling-v0.6.0
[0.5.0]: https://github.com/gvart/proschi/compare/tooling-v0.4.0...tooling-v0.5.0
[0.4.0]: https://github.com/gvart/proschi/compare/tooling-v0.3.0...tooling-v0.4.0
[0.3.0]: https://github.com/gvart/proschi/compare/tooling-v0.2.0...tooling-v0.3.0
[0.2.0]: https://github.com/gvart/proschi/compare/tooling-v0.1.0...tooling-v0.2.0
[0.1.0]: https://github.com/gvart/proschi/releases/tag/tooling-v0.1.0
