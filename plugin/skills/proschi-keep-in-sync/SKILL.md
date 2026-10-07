---
name: proschi-keep-in-sync
description: Keep a repository's Proschi (.proschi) architecture files in sync with its code - detect architecture drift in a branch, diff or pull request (a new service, datastore, queue or external API; a new dependency between services; a new or changed endpoint, consumer or status code) and update the nodes, connections, use cases and tests to match, then validate with `proschi check` and `proschi test`. Use when reviewing or preparing a PR in a repo that contains .proschi files, when the user asks whether the diagrams are still accurate, or wants CI that keeps them honest (the gvart/proschi GitHub Action).
license: MIT
---

# Keep .proschi files in sync with the code

Goal: after a code change, the repo's `.proschi` files describe the system as
the code now is, they pass `npx proschi@latest check` and `test`, the PR says
what changed in the architecture, and the user has a link to the updated
diagram.

Syntax: [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md).

## 1. Find the models and the change

```sh
git ls-files '*.proschi'                       # the models (and proschi.json for OpenAPI maps)
git diff --stat origin/main...HEAD             # or the PR's base branch
git diff origin/main...HEAD -- . ':(exclude)*.lock'
```

No `.proschi` files? Offer to create one (the `infra-to-proschi` and
`code-to-usecases` skills) instead of syncing.

## 2. Classify the diff

Drift is a change in *what talks to what* or *what the system offers*.
Read the diff for these signals:

| Signal in the diff | Model change |
|---|---|
| New deployable: Dockerfile, compose service, k8s Deployment, Helm chart, Terraform module/resource, Lambda, new `cmd/<name>/main.go` or app module | new node (right `[Tech]`, team, group) and its connections |
| New datastore / queue / bucket / cache client or resource; new topic or queue name | new node, or a new connection to an existing one |
| New env var or config pointing at a host (`*_URL`, `*_HOST`, `BROKERS`), new HTTP/gRPC client, new SDK (`stripe`, `twilio`, `openai`) | new connection (and an external node if needed) |
| New route/controller/handler, RPC method, consumer, scheduled job | new `usecase` (or a new `alt` in an existing one) |
| Changed path, method, status code, request/response shape | update the steps and payloads of that use case |
| New error handling, retry, fallback, timeout | new `alt` scenario (`-x` for the failed call) |
| Work moved to a queue or background job | `->` becomes `->>` plus worker steps after the response |
| Removed service, dependency or endpoint | remove the node / connection / use case (and fix `traffic`, `requirements`, `test` lines that name it) |
| Replica counts, instance sizes, autoscaling min | `xN`, `capacity { … size M }` |

Not drift: refactors inside one service, renamed variables, tests, docs,
dependency bumps with the same role. Say "no architecture change" and stop.

## 3. Update the model

- Edit the file that owns the thing (the architecture file for nodes and
  connections; the use case file for flows). Keep ids stable: renaming an id
  breaks `traffic`, `requirements`, `test` and links.
- Match the existing style (groups, teams, label conventions, comments).
- New use cases need a line in `traffic` if the file has one; add the
  scenarios to its `mix`.
- Anything you inferred rather than read: `# GUESS: …`.
- If the repo maps nodes to OpenAPI specs (`proschi.json`), update the spec
  mapping for new services.

## 4. Validate and iterate

```sh
npx proschi@latest fmt <changed files>
npx proschi@latest check --strict .
npx proschi@latest test .
```

Fix until clean. If a requirement or test now fails because of the code
change (e.g. a new synchronous call to a slow API breaks a p99 target or a
`never waits for` test), that is a real finding: report it in the PR, don't
delete the check. Run `npx proschi@latest analyze <file>` for designs with
traffic and mention cost or p99 changes.

## 5. Report

```sh
npx proschi@latest share-link docs/architecture.proschi
```

Add to the PR description (or your reply):

```markdown
### Architecture
- New node `notifications` [Go] (@growth), called by `orders` over gRPC.
- New use case "Unsubscribe" (POST /unsubscribe): 200, 404.
- `orders -> email` is now async via `events` (Kafka).
Checks: proschi check ✓, proschi test 7/7 ✓ · [Open the diagram](<share link>)
```

## 6. Keep it honest in CI (suggest once)

If the repo has no Proschi workflow, suggest the GitHub Action. It checks and
tests every `.proschi` file, annotates errors on their lines, and keeps one
comment per PR with each changed diagram's tests, cost, p99 and an *Open in
Proschi* link:

```yaml
# .github/workflows/proschi.yml
name: Proschi
on:
  pull_request:
    paths: ['**/*.proschi', '.github/workflows/proschi.yml']
  push:
    branches: [main]
    paths: ['**/*.proschi']

permissions:
  contents: read
  pull-requests: write # the comment; leave it out (or set comment: false) for none

jobs:
  proschi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: gvart/proschi/action@tooling-v0.9.0
        with:
          files: docs/**/*.proschi   # default **/*.proschi
```

Inputs: `files`, `test` (default `true`), `openapi` (`node=path/spec.yaml`
per line), `comment`, `render`, `version`. Docs:
<https://proschi.app/docs/editors/#github-action>. Elsewhere, two steps do
the checks: `npx proschi check --format github .` and
`npx proschi test --format github .`. The action catches broken diagrams, not
drift; drift is what this skill is for, so also suggest widening `paths` to
the code folders if the team wants the comment on every PR.

## Worked example

Diff: `services/orders/src/notify.ts` adds
`await fetch(process.env.NOTIFY_URL + '/notify', …)` in `POST /orders`, and
`deploy/notify.yaml` adds a Deployment `notify` (image `…/notify-go`, 2
replicas).

Model edits:

```proschi fragment
notify "Notification service" [Go] @growth x2   # deploy/notify.yaml
orders -> notify : HTTP                         # NOTIFY_URL in services/orders

# in usecase "Place order", branch "Paid", before the 201:
    orders  -> notify : POST /notify {"orderId": "o-1"}
    notify --> orders : 202
```

Then `fmt`, `check` and `test`. If the file has a `p99 "Place order"`
target, compare `analyze` before and after: the new synchronous hop adds
the notify service's latency to checkout. The code ignores the response, so
the PR note also suggests `orders ->> events : OrderPlaced` with `notify`
consuming it, and a test that keeps it that way:
`"Place order" never waits for notify`.
