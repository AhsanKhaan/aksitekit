# Security policy

This policy covers the AK Site Kit template itself: its agents, gates, scripts, workflows and vendored skills. A site
built from the template has its own policy in its `docs/SECURITY.md`, written by the `secops-reviewer` agent.

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
- A vendored skill under `vendor/skills/` that does more than its review in `docs/SKILLS.md` says (a hidden
  instruction, a network call, a script). Report it here and to its upstream project.
- The agents' rules in `CLAUDE.md` and `AGENTS.md`, when following them would cause harm.

## Out of scope
- Sites built from the template: report those to the site's owner.
- The services the kit talks to (GitHub, Cloudflare, Google, npm, skills.sh, Skillselion): report those to the
  service.
- Findings that need a paid tool to reproduce, or volumetric attacks.

## How the kit defends itself
Skills are vendored, pinned to commits at least 7 days old, hash-checked in CI and held to the skills.sh audit rule
(`docs/SKILLS.md`). GitHub Actions are pinned by commit SHA with least-privilege tokens. Secrets are scanned with
gitleaks on every push, code with Semgrep (and CodeQL once the repository is public), dependencies with `npm audit`, and
every pull request gets a code review.
