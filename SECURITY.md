# Security policy

This policy covers the AK Site Kit template itself: its agents, gates, scripts, workflows and vendored skills. A site
built from the template has its own policy in its `internal/docs/SECURITY.md`, written by the `secops-reviewer` agent.

## Reporting a vulnerability
Please report it privately. Don't open a public issue.

- **On GitHub:** use **Security → Report a vulnerability** on this repository
  (`https://github.com/AhsanKhaan/aksitekit/security/advisories/new`). GitHub offers this form on public repositories
  once private vulnerability reporting is turned on.
- **Include:** what's affected (file, workflow, agent or skill), the steps to reproduce it, the impact, and the commit
  you tested.
- **Never include** a live secret, token or key. If you found one, say where it is, and the owner will rotate it.

## What happens next
| Step | Within |
|---|---|
| We confirm we received it | 3 working days |
| First assessment and severity | 10 working days |
| Fix or mitigation for a high or critical issue | 30 days |
| Public disclosure, credited to you if you want | after the fix ships, or 90 days after your report, whichever comes first |

These are targets, not guarantees: the kit is maintained by one person [P].

## In scope
- The gate scripts, hooks and workflows: anything that lets a check pass when it should fail, a secret leak, an
  injection into a workflow, or an action or skill that isn't pinned.
- A vendored skill under `internal/skills/` that does more than its review in `internal/docs/SKILLS.md` says (a hidden
  instruction, a network call, a script). Report it here and to its upstream project.
- The agents' rules in `CLAUDE.md` and `AGENTS.md`, when following them would cause harm.

## Out of scope
- Sites built from the template: report those to the site's owner.
- The services the kit talks to (GitHub, Cloudflare, Google, npm, skills.sh, Skillselion): report those to the
  service.
- Findings that need a paid tool to reproduce, or volumetric attacks.

## How the kit defends itself
Skills are vendored in `internal/skills/`, pinned to commits at least 7 days old, hash-checked in CI and held to the
skills.sh audit rule (`internal/docs/SKILLS.md`). GitHub Actions are pinned by full commit SHA (the tag as a comment)
with least-privilege `permissions`. Nothing under `internal/` can reach production (README → "What reaches
production").

### Security review happens before code ships
- **On the plan:** the `security-plan` stage. The secops-reviewer reviews `internal/docs/ARCHITECTURE.md` before any
  code is written, and the gate needs `Verdict: PASS` with 0 blockers.
- **On the diff:** the `security-diff` stage. Semgrep, secrets, dependencies and workflow changes on the branch diff,
  before the pull request, for the exact HEAD commit.
- **On every pull request, before merge:**

| Workflow | What it checks |
|---|---|
| `codeql.yml` | CodeQL `security-extended` on the JavaScript and TypeScript |
| `security.yml` | gitleaks over the full git history, the npm audit gate, npm registry signatures, Semgrep CE rule packs |
| `dependency-review.yml` | fails on a new or upgraded dependency with a high or critical advisory |
| `ci.yml` | the skills hash check, unit tests, the workflow helpers' planted cases, and the site's full `verify` |
| Dependabot (`.github/dependabot.yml`) | weekly grouped updates for npm and GitHub Actions, with a 7-day cooldown |
| `scorecard.yml` | OpenSSF Scorecard on `main`, weekly and when branch protection changes |

### Repository settings (the owner's steps)
Some Scorecard checks score GitHub settings, not code. Agents never change these (`CLAUDE.md`: no writes to the owner's
accounts). The owner sets them once in the GitHub web UI:

1. **Branch protection** (Scorecard Branch-Protection). Go to **Settings → Rules → Rulesets → New branch ruleset**.
   Target the default branch (`main`), then turn on:
   - Restrict deletions; Block force pushes.
   - Require a pull request before merging, with 1 required approval, dismiss stale approvals on new commits, and
     require conversation resolution.
   - Require status checks to pass. Pick `tests and workflow helpers`, `gitleaks (git history)`, `npm audit gate`,
     `Semgrep (registry rules, no account)`, `CodeQL (javascript-typescript)` and
     `dependency review (new and changed dependencies)`. Turn on "require branches to be up to date".
   - Leave the bypass list empty, or add only yourself, for emergencies.
2. **Code review** (Scorecard Code-Review). The ruleset above needs one approval. A sole maintainer can't approve their
   own pull request. Either add a second reviewer with write access, or accept a lower Code-Review score: Scorecard
   counts reviewed changesets in the last 30 commits.
3. **Private vulnerability reporting.** Go to **Settings → Code security → Private vulnerability reporting → Enable**.
   This turns on the reporting form this policy points to.
4. **Code security features.** On the same page, turn on the dependency graph, Dependabot alerts, Dependabot security
   updates, and secret scanning with push protection. Leave CodeQL "default setup" **off**: the repository's own
   `codeql.yml` is the advanced setup, and the two can't run together.
5. **OpenSSF Best Practices badge** (Scorecard CII-Best-Practices). Sign in at `https://www.bestpractices.dev` with
   GitHub, add this repository, and answer the "passing" questionnaire (most answers are in this file, `README.md` and
   the workflows). Then add the badge it gives you to the top of `README.md` in a pull request.

Scorecard checks this kit can't satisfy by itself:
- **Maintained:** scores commits and issue activity over 90 days. It rises on its own as the repository ages and stays
  active.
- **Vulnerabilities:** counts open advisories in the lockfile. `npm run audit` gates high and critical; moderate ones
  are fixed through Dependabot's weekly pull requests, never by a hand-edited lockfile.
- **Fuzzing:** needs a fuzzing integration (OSS-Fuzz or ClusterFuzzLite). The kit's gates parse only the site's own
  build output, so the kit uses planted-case tests instead. This check is accepted as low.
- **SAST:** passes once CodeQL has run on the commits merged to `main`. `codeql.yml` runs on every pull request and
  push.
