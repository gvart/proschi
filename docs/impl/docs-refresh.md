# Docs refresh (temporary implementation doc)

Delete this file in the last commit of the refresh. Durable decisions go to
`.claude/skills/docs-writer/` and `docs/design/`.

## Goal

User-facing docs that are easy to read, follow and understand, with no AI
slop: short concept pages, an annotated start page, generated pictures, and
a local skill that keeps future docs consistent. Every page stays search
friendly.

## Decisions

- Split the 11k-word language reference into short concept pages.
  `/docs/language/` stays as an overview, and old `#anchor` links redirect to
  the new page. Why: each page is easy to finish.
- Start page: a hover/tap annotated example. Code is on one side and the live
  diagram on the other. Hovering or tapping a line shows a short note and
  lights up the matching box or arrow. Keyboard and touch must work.
- Extras: diagram images generated from Proschi source (committed, with a
  test that fails when they are stale), try-it prompts in live examples, a
  Playwright script that retakes editor screenshots (run by hand, not in CI),
  and 3–4 concept SVGs (how load flows, headroom, playback, team systems).
- SEO: every page has its own `<title>`, meta description, canonical URL and
  sitemap entry, plus internal links. No orphan pages, and old URLs keep
  working.
- A single style source: `.claude/skills/docs-writer/` holds the style guide
  and the anti-slop checklist, and `/blog-post` points at the same file
  rather than keeping a copy.
- Scope: the user-facing docs in the sidebar. Contributor docs (CARDS, GAME,
  PRACTICE authoring, PRIVACY) only get a light pass.

## Work items

- [ ] **D1 docs-skill**: `.claude/skills/docs-writer/SKILL.md` and the shared
  style guide (blog-post now refers to it). Also a page plan appended below:
  the sidebar, an old→new URL and anchor map, and a title and description for
  each page. verify: the user reviews the page plan. depends on: none.
- [ ] **D2 docs-interactive**: the annotated-example component and fence,
  try-it prompts, and the new start page (`docs/README.md`, slug `""`).
  verify: e2e on desktop and 390px, keyboard and touch, screenshots, live
  examples compile. depends on: D1.
- [ ] **D3 docs-language**: split LANGUAGE.md into concept pages, the
  overview page, the anchor redirects, sitemap and meta. verify: no broken
  internal links, every old anchor resolves, the sitemap lists every page,
  docsSite tests pass. depends on: D1. parallel with: D2 and D4 (disjoint
  files; D2 alone owns `frontend/plugins/docsSite.ts` and changes it
  additively; D3 asks main if it needs a change there).
- [ ] **D4 docs-pages**: rewrite QUICKSTART, MODEL, EDITORS, SHARING,
  AGENT-SKILLS and WHY to the skill. verify: word counts before and after, the
  anti-slop checklist passes, live examples compile. depends on: D1.
- [ ] **D5 docs-images**: generated diagram images, the screenshot script,
  and the concept SVGs, placed into the pages. verify: the user looks at every
  image; the staleness test passes. depends on: D2, D3 and D4.
- [ ] **Final**: delete this file and run the full checks from CLAUDE.md.

## Risks

- Anchor redirects only work client-side, because search engines never see
  `#fragments`. Keep `/docs/language/` as a real page that links to every new
  page.
- Several agents edit `docs/site.json`. D1 writes the target nav once, and
  later items only fill in pages that already exist in it.

## Page plan

(D1 appends it here.)
