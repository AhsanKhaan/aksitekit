# Idea: {{PROJECT_NAME}}

<!-- Template. idea-groomer fills it from research/inputs/idea.md (the owner's words) and research/out/recon/*.md.
Every placeholder (double-brace, upper-case names) must be replaced. Keep the nine "## " headings: the idea gate
(node .claude/skills/gate/gate.mjs idea) finds the sections by them. Label every number [M] measured, [R] range,
[P] proxy/estimate, [U] unverified, with its source. The owner approves this file as a whole (APPROVE <hash>), so
any later change needs their approval again. -->

| | |
|---|---|
| Domain | {{DOMAIN}} |
| Owner's idea | `research/inputs/idea.md`, given {{IDEA_DATE}} |
| Matched against | {{RECON_COUNT}} recon files in `research/out/recon/` |
| Last groomed | {{DATE}} |

## 1. The owner's idea
{{OWNER_IDEA}}

<!-- The owner's words from research/inputs/idea.md → "In the owner's words", unchanged, as a blockquote. The gate
compares them. Then one plain sentence: what the idea is, as you understood it. -->

## 2. Visitors and their jobs
{{VISITORS}}: who comes to the site, in what situation (circumstances, not demographics).

| Job | When … I want to … so I can … | Dimension | From |
|---|---|---|---|
| J1 | {{JOB_STATEMENT}} | functional / emotional / social | the owner's idea, or a recon file and section |

## 3. Coverage by competitor
How well each competitor lets a visitor do each job, from that competitor's "Against the owner's idea" section and
its feature matrix. Every competitor domain gets a column; every job gets a row.

| Job | {{COMPETITOR_DOMAIN}} | Best today |
|---|---|---|
| J1 | yes / partly / no: what the visitor gets ({{RECON_REF}}) | {{BEST_TODAY}} |

## 4. Where we can win
{{GAPS}}: jobs nobody serves well, what readers complain about across competitors (counts from the recon files'
"What readers say" [M]), and UX or speed gaps a static site can beat. Each item names its recon file and section.

## 5. Features
| Feature | Job | Priority | Page type | Evidence |
|---|---|---|---|---|
| {{FEATURE}} | J1 | must / should / could / won't | tool / guide / hub / instance | {{EVIDENCE}} |

Priority: **must** is wave 1, **should** is the next wave, **could** waits for traffic, **won't** says why not.
Every job has at least one row.

## 6. Wave 1
{{WAVE1_SLICE}}: the smallest version that does the top job better than anything in §3, built from the "must" rows.
The keyword map decides the URLs; this says what the first pages must let a visitor do.

## 7. Positioning
For {{WHO}} who {{PROBLEM_IN_PLAIN_WORDS}}, {{PROJECT_NAME}} {{DOES_THIS_INSTEAD}}.
Evidence: {{THEME}}, {{REVIEW_COUNT}} reviews across {{SOURCE_COUNT}} sources [M].

## 8. Out of scope
What the template rules out (user accounts, forms that store data, paid tools, copying a competitor), YMYL topics
unless the owner decides otherwise, and what is parked for later with the reason: {{OUT_OF_SCOPE}}.

## 9. Open questions for the owner
<!-- One line each. "- [ ] question" while it waits; "- [x] question → the owner's answer (date)" once
research/inputs/idea.md → "Owner answers" has it. The gate stays BLOCKED while any "- [ ]" is left. Write "None." when
there are none. -->
- [ ] {{QUESTION}}
