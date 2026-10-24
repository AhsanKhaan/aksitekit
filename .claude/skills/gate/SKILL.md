---
name: gate
description: Run one pipeline stage's deterministic gate and record the result in the ledger (reports/ledger.md), or show which stage is next. Use for "/gate <stage>", "run the gate", "did the design stage pass", "pipeline status", "what's blocking".
argument-hint: "<stage> [--url <url>] | status | list | record <stage> <RESULT> \"<evidence>\""
---

Run: `node .claude/skills/gate/gate.mjs $ARGUMENTS` (no arguments: `status`).

The runner reads `.claude/skills/gate/stages.json`, checks the stage's output files and built-in checks, runs its npm
gates in order (`docs/CONTRACT.md` names them), and appends one row to `reports/ledger.md`. **It decides; you report.**

## Reading the result
| Exit | Result | What to do |
|---|---|---|
| 0 | PASS / SKIPPED | Say so and name the next stage |
| 1 | FAIL | Quote the failure line. Fix the cause in the agent's output (or hand it back to that agent) and re-run. Never edit thresholds, tests or `stages.json` to get a pass |
| 3 | BLOCKED | Say what's missing and who provides it: the owner (CSVs, DR, a decision), **Step C** (`docs/TODO-step-c.md`: starter app and gates), **Step B** (keyword pipeline) or **Phase E** (a `package.json` script) |
| 2 | usage | Show the usage line |

- Three FAILs in a row with the same evidence: stop and ask the owner (the runner prints a reminder).
- `record` is only for what a script can't see: `preprod` (CI green on the PR, confirmed by the owner or `gh`) and `go`
  (the owner's own words, `GO <sha>`). Never record a PASS for any other stage, and never record a GO the owner didn't
  type in chat.
- `--url` takes a plain `http(s)://host/path` URL of the project's **own** preview or production host. Never a third
  party's.

Label numbers in your summary ([M] for what the runner measured).
