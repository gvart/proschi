# Writing practice cards

Practice cards are short questions for daily review: a fact to recall, an
option to pick, a number to estimate or a gap to fill. Each card is one
Markdown file in `frontend/src/practice/cards/<topic>/<id>.md`; there is
nothing to register. The practice page, the API and `proschi cards check`
read the same files with the same code (`frontend/src/learn/cards.ts`), which
has no browser or React dependency, so a mobile app can read them too.

## Folder layout

```text
frontend/src/practice/cards/
  tags.json             the topics: [{"id", "title", "summary"}]
  ids.lock              every card id ever published, sorted
  <topic>/<id>.md       one card; the folder is a topic from tags.json
```

The **file name is the card's id**. Review history is stored by id, so an id
never changes and is never reused:

- To move a card to another topic, move the file; the id stays.
- To remove a card, set `status: retired` in its front matter and keep the
  file. Retired cards are no longer reviewed. Deleting the file fails the
  check, because `ids.lock` still lists the id.
- After adding cards, run `proschi cards lock` to add their ids to
  `ids.lock`, and commit it with the cards.

Ids are lowercase words joined by `-`, unique across all topics, and say what
the card asks, e.g. `cache-stampede` or `three-nines-downtime`.

## Front matter

```markdown
---
type: flip
difficulty: medium
tags: [availability]
related: [chat, discord-messages]
decks: [sample]
---
```

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `flip`, `choice`, `estimate` or `cloze` (below) |
| `difficulty` | yes | `easy`, `medium` or `hard` |
| `tags` | no | Other topics from `tags.json` the card also trains. The folder is always its first tag; do not repeat it |
| `related` | no | Ids of practice problems the card prepares for |
| `decks` | no | `sample`: the free deck anyone can try without an account (20–40 cards) |
| `version` | no | A whole number, 1 when absent. Bump it when the **answer** changes, so people who learned the old answer review the card again. Typo fixes and rewording keep it |
| `status` | no | `retired` to stop reviewing the card (see above) |
| `distinct-from` | no | Card ids the overlap check should not call duplicates of this one |
| `answer`, `unit`, `tolerance` | estimate only | See [Estimate](#estimate) |

The front matter is the same strict YAML subset as a problem's
([PRACTICE.md](PRACTICE.md#problemmd)).

## Card types

The body is made of `## ` sections. Each type takes its own; every type may
add `## Why`, shown after answering: why the answer is right, the trade-off or
a common mistake. The sections are Markdown, rendered like problem statements.

### Flip

A question and an answer. The reviewer thinks of the answer, flips the card
and rates how well they remembered it.

```markdown
## Front

Why use consistent hashing instead of `hash(key) % N` to pick a shard?

## Back

With `% N`, adding one server remaps almost every key; with consistent
hashing only about 1/N of the keys move.
```

### Choice

A question and 2–6 options, exactly one marked `[x]`. Options are shuffled
when shown, so do not write "all of the above".

```markdown
## Question

Which cache write policy can lose acknowledged writes if the cache crashes?

## Options

- [ ] Write-through
- [x] Write-back
- [ ] Write-around
```

### Estimate

A back-of-envelope number. The answer counts as right within a factor of
`tolerance` (default 2: from half to double the answer), and the reviewer is
told how far off they were.

```markdown
---
type: estimate
difficulty: easy
answer: 2300
unit: requests/s
---

## Question

10 million daily users make 20 requests a day each. What is the average load?

## Solution

10M × 20 = 200M a day; ÷ 86,400 s ≈ **2,300 requests/s**.
```

`answer` is a number above 0 (no exponents or thousands separators), `unit`
what it counts, `tolerance` a factor from 1.1 to 10. Use a tighter tolerance
for numbers people should know closely (99.9% is 43 minutes a month: 1.5).
`## Solution`, the worked calculation, is required.

Take the round numbers from [Numbers to know](NUMBERS.md), and end the
solution (or `## Why`) with a pointer to the section it draws on:
`Numbers: [Numbers to know](../docs/numbers/#latency).` The link is relative
to the practice page, where cards are shown.

### Cloze

Text with 1–3 gaps written `{{answer}}`. List other accepted answers after
`|`: `{{cache stampede|thundering herd}}`. The first one is shown as the
answer. Typed answers are compared ignoring case, punctuation and a trailing
"s", so list real alternatives, not spellings.

```markdown
## Text

When many requests miss a hot key at once, it is a {{cache stampede|thundering herd}}.
```

## Writing good cards

- **One idea per card.** If the back needs "and also", make two cards.
- **Fit a phone.** The question is at most 300 characters, a flip card's back
  600, an option 140, `## Why` and `## Solution` 1,200. Move detail to
  `## Why`.
- **Ask for the trade-off**, not the definition: "what does X cost?" and
  "when would you pick X over Y?" teach more than "what is X?".
- **Use real numbers** in estimates, and show every step of the arithmetic.
- **Link problems** with `related`, so the practice page can suggest the
  card before and after the problem.

## Reviewing

Daily review is on the practice page, `practice/#/review` (`#/review/<topic>`
trains one topic). Each day brings the cards that are due, then up to 10 new
ones: the sample deck's first, then the rest, each one topic at a time in
`tags.json` order and easy before hard; training
a topic is not held to that limit. Flip cards are rated again, hard, good or
easy; the others are graded automatically: wrong is again, right is good
(or easy, when the reviewer says so). An estimate accepts `2300`, `2,300`,
`2.3k`, `1e6` or `5M`, and "showing the answer" of a cloze card counts as
again.

The schedule is FSRS-5 with its default weights, aiming at 90% recall
(`frontend/src/learn/fsrs.ts`); the queue is `frontend/src/learn/review.ts`.
Both are plain TypeScript the Worker runs too: signed in, the page sends its
reviews to the API in batches (backend/README.md) and the server replays
them into the same states. Signed out, only the `sample` deck is offered and
nothing is saved. A card whose `version` went up is new again for everyone.

Each live card also gets a static page, `practice/cards/<topic>/<id>/`,
with its question, answer, `## Why`, related problems and a link into daily
review, under one page per topic (`practice/cards/<topic>/`) and an index
(`practice/cards/`), all in the sitemap (`frontend/plugins/cardPages.ts`).
Relative links in a card, like the one to Numbers to know, are written from
the practice page as above; the build rewrites them for these pages.

### Cards from a mistake

When a run on a problem page fails like one of the problem's known wrong
designs, the page shows the mistake with the cards that train it
([PRACTICE.md](PRACTICE.md#known-mistakes)), and **Add these cards to my
review** puts them in the focus queue (`FocusQueue` in
`frontend/src/learn/review.ts`): due now, first in the next session, whether
they are new, not due yet or outside the sample deck, and outside the daily
allowance of new cards. A card leaves the queue once it is reviewed after it
was added. The queue is kept in the browser (`proschi.cards.focus`); the
reviews themselves are stored like any other, on the server when signed in.

The build also publishes every card as `practice/cards.json`,
`{format: 1, hash, topics, cards}`, for apps: `hash` changes with any
content, and `format` only when a field changes meaning.

### Daily goal and streak

A day counts toward the streak when it meets the daily goal, which any
daily practice does: 10 cards reviewed (5, 20 or 30 when the learner picks
so), a problem solved for the first time, the daily challenge completed, or
a Scale or Fail (Arcade) run finished (played to the end; a run only started
does not count). Every 7 counting days in a row earn a freeze, up to 2,
which covers a missed day automatically. The rules, the milestones (3, 7,
14, 30, 50 and 100 days) and the weekly recap (which lists challenges and
Arcade runs in weeks that had any) are `frontend/src/learn/streak.ts`,
which the Worker runs too: signed in, `GET /api/me/activity` answers the
streak from the local dates of the reviews, the solves, the challenges sent
and the game runs submitted (backend/README.md); challenges and runs from
before their local date was kept count on the challenge's UTC day and the
UTC date of the run, and runs played signed out (imported at sign-in) do
not count, like imported solves. A build without accounts computes it from
this browser's reviews, solves, challenge results and finished-run days;
signed out there is no streak. The streak badges count the same streak.

### Daily challenge

The practice page's daily challenge (`practice/#/challenge`, the Challenge
tab of the practice hub) is the same five cards for everyone each day. The day is the **UTC date**, so it starts at
00:00 UTC everywhere. The rules are `frontend/src/learn/challenge.ts`, which
the Worker runs too:

- **The cards**: only `choice`, `estimate` and `cloze` cards (graded
  automatically, so everyone is scored alike), never retired ones, picked by
  a generator seeded with the date. One estimate card when there is one, then
  cards from topics not picked yet, at most two of a difficulty and two of a
  type; shown easy to hard. A choice card's options are shuffled the same way
  for everyone that day.
- **The score**: 100 points per right answer plus a speed bonus of up to 20,
  all of it within 10 s of the card showing, falling linearly to 0 at 60 s
  (`round(20 × (60 − t) / 50)` for `t` seconds in between). A wrong answer
  scores 0. Five cards make at most **600**; one more right answer is always
  worth more than any speed.
- **One attempt**: signed in, the server picks the cards, grades the
  answers itself, keeps only the first attempt of the day and ranks it among
  the day's (by score, then the total time). It also records when the first
  card was shown, once a day, and refuses answers whose times add up to more
  than the time since. Each answer is kept in the browser the moment it is
  given, so a reload carries on at the next card; a challenge left unfinished
  at midnight is sent as it stands within 15 minutes, else dropped. The
  leaderboard lists the top 20 of those who chose to appear on the
  leaderboard, each linked to their public profile; everyone else is counted
  but not named.
- **The daily streak**: a completed challenge meets the daily goal by itself
  (above), so it keeps the one daily streak, and every answer is also a
  review of its card.
- **The challenge streak**: days in a row with a completed challenge (UTC
  days, no freezes). It is a sub-stat of the daily streak, not a second
  streak: the challenge page shows it as "Challenge: 4 days in a row" (no
  flame), and a public profile and the account page show it, the longest
  one and the best score. The `challenge-streak` badges count it.

Signed out, the challenge is scored in the browser and can be saved to an
account after signing in; a copy of the site without accounts keeps every
result in the browser, from which it counts the challenge streak and the
challenge's days for the daily streak.

## The check

`proschi cards check` (CI runs it on every pull request):

- every file reads as a card of its type, with only the fields and sections
  that type takes;
- ids are unique, every card is in `ids.lock`, the lock is sorted, and every
  id in it still has a file;
- topics and tags are in `tags.json`, and `related` names real problems;
- the text fits the limits above, and a choice card has no repeated option;
- **no two cards ask nearly the same thing**. The check compares the
  meaningful words of every pair of cards (question, and question with
  answer) and reports pairs that overlap by 40% or more. A reworded copy of a
  card scores about 50%; unrelated cards on one topic score under 25%. Merge
  or reword a flagged pair, or, if they really test different things, add
  `distinct-from: [<other id>]` to one of them.

```sh
cd tooling && npm run build
node dist/cli.cjs cards lock ../frontend/src/practice/cards
node dist/cli.cjs cards check ../frontend/src/practice/cards
```

## The skill map and achievements

The practice page's progress page (`practice/#/progress`) scores each topic
from 0 to 100% and shows the badges a learner has earned. Signed in, the
server decides both (`GET /api/me/achievements`, backend/README.md); a copy
of the site without accounts computes the same from the browser's data.

**Mastery** of a topic (`frontend/src/learn/mastery.ts`) blends:

- recall: the predicted chance of remembering each of the topic's cards now,
  averaged over all of them, a card never reviewed counting 0 (weight 0.55);
- coverage: the share of its cards reviewed (0.15);
- problems: the related problems solved, those its cards name in `related`
  and those tagged with the topic's id, three counting in full (0.30, left
  out when nothing relates);
- for `estimation` only, the share of the last 20 estimate cards answered
  right (0.30).

The weights of the parts that apply are scaled to add up to 1. "Interview
ready" is the topics' mastery weighted by their number of cards, and the
three weakest topics link to `#/review/<topic>`.

**Achievements** are data, in `frontend/src/practice/achievements.json`:

```json
{ "id": "reviews-100", "title": "Hundred club", "description": "Review 100 cards.", "icon": "layers", "tier": "bronze", "rule": { "kind": "reviews", "min": 100 } }
```

`tier` (`bronze`, `silver` or `gold`) is optional; `icon` is one of the names
in `ICONS` (`frontend/src/learn/achievements.ts`). The rule kinds:

| `kind` | Fields | Earned when |
|---|---|---|
| `reviews` | `min` | that many card reviews, in all |
| `mastered` | `min` | that many cards with a stability of 21 days or more |
| `streak` | `min` | a daily streak (above) of that many days at its longest, freezes included |
| `solved` | `min`, `difficulty?`, `tag?` | that many problems solved, of that difficulty or tag |
| `all-solved` | `tag` | every problem with the tag solved |
| `first-run` | `min` | that many problems solved on the first test run |
| `under-reference` | `min` | that many solves cheaper a month than the reference solution |
| `estimate-streak` | `min` | that many estimate cards right in a row |
| `mastery` | `topic`, `min` (0–1) | the topic's mastery at `min` or more |
| `stage` | `stage` | every problem of the roadmap stage solved |
| `challenges` | `min` | that many daily challenges completed |
| `challenge-perfect` | `min` | that many daily challenges with every card right |
| `challenge-streak` | `min` | a challenge streak of that many days at its longest |
| `lessons` | `min`, `stage?` | that many problem lessons read, of that roadmap stage |
| `stage-lessons` | — | every lesson of some roadmap stage read |
| `all-lessons` | — | every problem lesson read |

An id never changes and is never reused: earned badges are stored by it, in
the `achievements` table. A badge once earned stays earned. Like the cards'
`ids.lock`, `frontend/src/practice/achievements.lock` (next to the JSON file)
lists every achievement id ever published, sorted:

- To remove a badge, add `"retired": true` to it and keep it in the file.
  A retired badge is no longer evaluated or shown, and the badges already
  earned stay stored. Its rule may name a tag, topic or stage that is gone,
  and a new badge may reuse its rule. Deleting it fails the check, because
  `achievements.lock` still lists the id.
- After adding badges, run `proschi achievements lock` to add their ids to
  `achievements.lock`, and commit it with them.

`proschi achievements check` (CI runs it) checks the file: unique ids, known
icons, tiers and kinds, each rule with exactly its fields, tags, topics and
stages that exist, counts the problems can reach, no two badges with the same
rule, and every id in `achievements.lock` and every locked id still in the
file.

```sh
cd tooling && npm run build
node dist/cli.cjs achievements lock
node dist/cli.cjs achievements check
```

Suggestions for new cards or fixes are welcome as issues or pull requests:
[CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-new-card) has the
step-by-step checklist, and the
[card template](https://github.com/gvart/proschi/issues/new?template=card-idea.md)
suggests one without writing the file.
