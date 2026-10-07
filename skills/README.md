# Proschi agent skills

Skills that teach AI coding agents (Claude Code, Codex, Cursor, Copilot,
Gemini CLI and others) to turn what a repository already has into
[Proschi](https://proschi.app/) models, and to check them with the `proschi`
CLI. Each folder is one skill in the open
[Agent Skills](https://agentskills.io) format: a `SKILL.md` with `name` and
`description` front matter, and a `references/proschi-cheatsheet.md` with the
whole language on one page.

| Skill | Use it to |
|---|---|
| [`infra-to-proschi`](infra-to-proschi/SKILL.md) | Model an existing system from docs, Mermaid, Terraform, CloudFormation, CDK, Kubernetes, Helm or docker-compose |
| [`code-to-usecases`](code-to-usecases/SKILL.md) | Write `usecase` request flows (responses, async, `par`, `alt` failures) from routes, handlers, consumers and clients, or from an OpenAPI spec |
| [`proschi-capacity-plan`](proschi-capacity-plan/SKILL.md) | Add traffic, requirements and replicas from SLOs or load, run `proschi analyze`, fix bottlenecks |
| [`proschi-design-review`](proschi-design-review/SKILL.md) | Review a design: single points of failure, saturation, missing failure scenarios, cost waste, with concrete edits |
| [`proschi-keep-in-sync`](proschi-keep-in-sync/SKILL.md) | Update `.proschi` files when a change adds a service, dependency or endpoint; set up the GitHub Action |
| [`proschi-hld-doc`](proschi-hld-doc/SKILL.md) | Generate a high-level design document (`proschi render --format hld-md`) |

Every skill validates its output with `npx proschi check` and `test`,
iterates until clean, and ends with a link that opens the diagram in the
web editor (`npx proschi share-link <file>`). They need Node 18 or newer;
`share-link` and `import` need `proschi` 0.9 or newer.

## Install

**Claude Code**: this repository is a plugin marketplace. In Claude Code:

```text
/plugin marketplace add gvart/proschi
/plugin install proschi@proschi
```

The skills then show up as `/proschi:infra-to-proschi` and so on, and Claude
uses them when a task matches; `/plugin marketplace update proschi` gets new
versions. Or copy the folders by hand, for yourself or for one project
(commit `.claude/skills/` to share them with your team):

```sh
npx degit --force gvart/proschi/skills ~/.claude/skills     # every project
npx degit --force gvart/proschi/skills .claude/skills       # this project only
```

**Codex, Cursor, Copilot, Gemini CLI and other agents**: put the skills in
the repository, then point the agent's instructions file at them:

```sh
npx degit gvart/proschi/skills .agents/skills
```

| Agent | Add to | Line to add |
|---|---|---|
| Codex, and any agent that reads `AGENTS.md` | `AGENTS.md` | `For architecture diagrams (.proschi files), follow the matching skill in .agents/skills/*/SKILL.md.` |
| Cursor | `.cursor/rules/proschi.mdc` | the same line, with front matter `description: Proschi architecture diagrams` (Cursor also reads `AGENTS.md`) |
| GitHub Copilot | `.github/copilot-instructions.md` | the same line |
| Gemini CLI | `GEMINI.md` | the same line, or `@.agents/skills/infra-to-proschi/SKILL.md` to import one skill |

Agents that support Agent Skills natively load `.agents/skills/` (or their
own skills folder) without the extra line; check your agent's docs.

Without `degit`: `git clone --depth 1 https://github.com/gvart/proschi /tmp/proschi && cp -R /tmp/proschi/skills .agents/skills`.

## Editing the skills

Keep each `SKILL.md` short (under ~200 lines) with one worked example; the
`references/proschi-cheatsheet.md` files are identical copies (so each skill
folder works on its own). `tooling/test/skills.test.ts` checks the front
matter, that the copies match, and that every full ` ```proschi ` example
passes `check --strict`, `fmt --check` and `test`.
