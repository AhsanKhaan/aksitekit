---
name: start
description: Start or resume the site pipeline for this copy of the adsense-site-factory template. Asks for the domain and competitors (with the DR the owner supplies), picks the lowest-DR competitor as the keyword seed, tells the owner when to drop Keyword Planner CSVs, then runs each stage and its gate in order and records the ledger. Use for "/start", "start the site", "resume the pipeline", "what's next".
argument-hint: "[resume | status | <stage id>]"
disable-model-invocation: true
---

Run the pipeline in **this** session (mode: `$ARGUMENTS`; empty means resume from the ledger). You are the
orchestrator: read `.claude/agents/orchestrator.md` and follow it as your runbook. It runs here, not as a subagent,
because it asks the owner questions and hands stages to other agents.

## 0. Before anything
1. Read `CLAUDE.md` and `AGENTS.md` (§1 rules, §3 flow, §4 gate table, §5 ledger).
2. Run `node .claude/skills/gate/gate.mjs status`. If stages already passed, say which, and resume at the `next` stage
   (re-run its gate first; don't trust old results). `status` as the argument stops here.
3. Keep the task list current: one step per stage you'll run this session.

## 1. Intake (orchestrator)
Ask the owner, in one message:
- **Domain** of the new site (registered or planned), and a working **name/brand** if they have one.
- **Competitors:** 2–5 domains, each with its **DR** (Domain Rating) and an optional note.
  - **Never look up DR yourself** (no scraping, no paid API). The owner reads it from a tool they already use, for
    example a free DR or authority checker. Label it [M: owner] in the ledger.
  - If the owner doesn't know a DR, the competitor waits until they do.
- **Markets and language**, if they differ from `factory.config.json` (`project.locale`, `project.markets`).
- **Technology:** "Build with **Next.js** (the built-in starter) or **another technology**? If another, which one
  (for example Astro, Eleventy, Hugo, Vite, SvelteKit, Remix)?" Never choose for the owner; if they're unsure, explain
  the trade-off in two lines and let the architect recommend one at the architecture stage, after the keyword map shows
  what the site needs.

Write what they said, and nothing they didn't:
- `factory.config.json`: `project.domain`, `project.name`, `project.brand`, `project.locale`, `project.markets`,
  and `competitors: [{ "domain", "dr", "notes" }]`.
- `factory.config.json` → `build`:
  - **Next.js:** `framework: "nextjs"`; keep the shipped `outputDir: "out"` and `commands` (`next build && node
    scripts/flatten-segments.mjs`, `next dev`). The starter is built from `docs/TODO-step-c.md`.
  - **Another technology:** `framework: "<name>"` (lowercase). Set `outputDir` and `commands.build` / `commands.dev`
    only if the owner gave them; otherwise leave the Next.js defaults in place and mark them for the architect, who
    sets them at the architecture stage (the intake gate only needs a non-empty build command). Changing
    `package.json` dependencies for the new technology is a Phase E change with the supply-chain checklist.
- `research/inputs/competitors.csv`: header `domain,dr,notes`, one row per competitor (domains without `https://` or
  `www.`).

Gate: `node .claude/skills/gate/gate.mjs intake`. It prints the **seed**: the competitor with the lowest DR (ties:
alphabetical). Tell the owner which one it is and why: a low-DR site that still ranks shows keywords a new site can win.

## 2. Ask for the Keyword Planner CSVs, and run recon meanwhile
Tell the owner exactly this (fill in the seed and markets):
1. Open Google Keyword Planner → **Discover new keywords** → **Start with a website**.
2. Enter the seed domain, choose **Use the entire site**, and set the location and language to the project's markets.
3. Download **Historical metrics** as CSV (Keyword Planner's own file, UTF-16 tab-separated, is fine; so is Google
   Sheets → CSV UTF-8). Don't open it in Excel and re-save it as `.xlsx`.
4. Save it as `research/inputs/kp/<seed-domain>.csv`. Other competitors are optional, one file each, named the same way.
5. Say "CSVs are in" when done.

Keyword Planner is free with a Google Ads account; without ad spend it may show ranges instead of exact volumes
[U: depends on the account]. Never ask for Google Ads credentials, and never open the account for the owner.

While waiting, run **recon**: hand each competitor to the `competitor-recon` agent (one call per competitor, in
parallel), then `node .claude/skills/gate/gate.mjs recon`.

## 3. Run the stages in order
For each stage after recon, in the order of `.claude/skills/gate/stages.json`:
1. Hand the stage to its agent (Agent tool, `subagent_type` = the agent name), with the inputs it lists and the
   ledger's last note for the stage.
2. Run the gate: `node .claude/skills/gate/gate.mjs <stage>` (add `--url <url>` for `security` and `deploy`).
3. **PASS** → next stage. **FAIL** → give the failure lines to the same agent and retry; after 3 failed attempts with
   the same failure, stop and ask the owner. **BLOCKED** → read the `next` column:
   - an owner input (CSVs, a DR, a decision): ask the owner, then wait;
   - **a Step C script or file** (the starter app and most gates aren't built yet): say so plainly, e.g. "`npm run
     gate:design` doesn't exist yet: it comes from Step C, see `docs/TODO-step-c.md`";
   - a Phase E `package.json` script: say which one is missing and that Phase E adds it.

**Planning stages may run ahead of missing scripts.** `strategy`, `growth`, `architecture` and `design` write
documents. If one of them is BLOCKED *only* because a Step C or Phase E script doesn't exist yet, keep its BLOCKED row,
tell the owner, and continue to the next planning stage. Those stages re-run first once the scripts exist.
**`build` and every stage after it need every earlier stage at PASS.** No exceptions.

## 4. Pre-production, GO, deploy
- `preprod`: open a PR from the working branch to the production branch (`hosting.productionBranch`). When
  `preprod.yml` is green for the exact SHA (the owner confirms, or `gh run list --commit <sha>` if `gh` is
  installed), record it: `node .claude/skills/gate/gate.mjs record preprod PASS "preprod.yml green on PR #<n> for <sha>"`.
- `cloudflare`: only when `hosting.target` is a Cloudflare target; hand it to `cloudflare-reviewer` (reads only), then
  `node .claude/skills/gate/gate.mjs cloudflare`. Any write it proposes needs the owner's yes, one call at a time.
- `go`: show the GO/NO-GO summary and wait. Only the owner typing `GO <sha>` for this exact SHA counts. Record it with
  their words: `node .claude/skills/gate/gate.mjs record go PASS "owner typed: GO <sha>"`.
- `deploy`: run `/deploy-production deploy`.
- `docs`: hand to `doc-generator`, then `node .claude/skills/gate/gate.mjs docs`.

## 5. Report (every time you stop)
1. A table: stage, result, evidence (from the ledger).
2. **Owner to do** (numbered, short) and **done in code** as separate lists.
3. The one next action, and the command that resumes: `/start`.

Free tools only: if any step would need a paid tool, API, plan or trial, stop and ask the owner; if they say no, propose
a free alternative.
