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

Suggestions for new cards or fixes are welcome as issues or pull requests.
