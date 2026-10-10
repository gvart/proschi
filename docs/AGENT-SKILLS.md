# Agent skills

Proschi ships skills for AI coding agents: Claude Code, Codex, Cursor,
GitHub Copilot, Gemini CLI and any other agent that reads instruction files.
With them, an agent turns what your repository already has (docs, Mermaid,
Terraform, Kubernetes, docker-compose, application code, OpenAPI specs) into
a Proschi model, checks it with the [`proschi` CLI](EDITORS.md#install) until
it is clean, and gives you a link that opens it in the editor.

The skills are in [`plugin/skills/`](../plugin/skills/) in the open
[Agent Skills](https://agentskills.io) format: one folder per skill with a
`SKILL.md` and a one-page cheat-sheet of the language.

| Skill | What it does |
|---|---|
| `infra-to-proschi` | Models an existing system from prose, a README, Mermaid (`proschi import mermaid`), Terraform, CloudFormation, CDK, Kubernetes, Helm or docker-compose: catalog techs, groups for networks and clusters, connections from env vars, service URLs and security groups, guesses marked as comments |
| `code-to-usecases` | Writes `usecase` blocks from HTTP routes, gRPC services, consumers, database, cache and HTTP client calls (Spring, Express, NestJS, FastAPI, Django, Go, Rails, …): requests, responses, fire-and-forget, `par`, `alt` failures; OpenAPI specs via `proschi import openapi` |
| `proschi-capacity-plan` | Adds `traffic`, `requirements` and replicas, shards or capacity from SLOs or expected load, runs `proschi analyze` and fixes the bottlenecks |
| `proschi-design-review` | Reviews a design with `check`, `test` and `analyze`: single points of failure, saturation, missing failure scenarios, cost waste, with concrete edits |
| `proschi-keep-in-sync` | Finds architecture drift in a pull request (a new service, dependency or endpoint) and updates the `.proschi` files; suggests the [GitHub Action](EDITORS.md#github-action) |
| `proschi-hld-doc` | Fills in the model and generates the [HLD document](EDITORS.md#hld-documents) with `proschi render --format hld-md` |

Every skill ends the same way: `npx proschi check` and `npx proschi test`
until clean, then `npx proschi share-link <file>`. The skills need Node 18
or newer; `share-link` and `import` need `proschi` 0.9 or newer.

## Claude Code

The Proschi repository is a Claude Code plugin marketplace. In Claude Code:

```text
/plugin marketplace add gvart/proschi
/plugin install proschi@proschi
```

Claude then uses a skill when a task matches (*"diagram our docker-compose
in Proschi"*), or you call one directly: `/proschi:infra-to-proschi`.
`/plugin marketplace update proschi` fetches new versions.

Without the plugin, copy the skills into your personal or project skills
folder (commit `.claude/skills/` to share them with your team):

```sh
npx degit --force gvart/proschi/plugin/skills ~/.claude/skills     # every project
npx degit --force gvart/proschi/plugin/skills .claude/skills       # this project only
```

## Codex, Cursor, Copilot, Gemini CLI and others

Copy the skills into the repository:

```sh
npx degit gvart/proschi/plugin/skills .agents/skills
```

Then add one line to the agent's instructions file, so it knows where they
are:

```text
For architecture diagrams (.proschi files), follow the matching skill in .agents/skills/*/SKILL.md.
```

| Agent | Instructions file |
|---|---|
| Codex, and any agent that reads `AGENTS.md` | `AGENTS.md` |
| Cursor | `.cursor/rules/proschi.mdc`, with front matter `description: Proschi architecture diagrams` (Cursor reads `AGENTS.md` too) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Gemini CLI | `GEMINI.md` (or import one skill: `@.agents/skills/infra-to-proschi/SKILL.md`) |

Agents with native Agent Skills support load the folders without that line;
see your agent's documentation for the folder it reads. Without `degit`:
`git clone --depth 1 https://github.com/gvart/proschi /tmp/proschi && cp -R /tmp/proschi/plugin/skills .agents/skills`.

## What to ask

- *"Model our infrastructure from `deploy/` and `docker-compose.yml` in Proschi."*
- *"Write Proschi use cases for the checkout endpoints, including the failure paths."*
- *"We expect 5k rps on search with a p99 under 200 ms: size the design."*
- *"Review `docs/architecture.proschi` before the design review."*
- *"This PR adds a notification service: update the diagrams."*
