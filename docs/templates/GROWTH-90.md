# 90-day growth plan: {{PROJECT_NAME}}

<!-- Template. growth-strategist fills it together with growth/plan.json (the file /today reads). Replace every
placeholder (double-brace, upper-case names). Targets are [P]; results are [M] with their source.
Gate: node .claude/skills/gate/gate.mjs growth. -->

**Start:** {{START_DATE}} · **Your time:** {{MINUTES_PER_DAY}} minutes a day, {{DAYS_PER_WEEK}} days a week

## How this plan works
- **One task a day.** 25–45 minutes, one result. `/today` shows only today's task and your streak; nothing else.
- **A clear "done" check.** Every task ends with something you can see: a page is live, a file exists, a number is
  written down. If you can't tick it, it isn't done yet, and that's fine.
- **One theme a week.** Monday: 10 minutes to look at the week's tasks. Friday: 10 minutes to review what moved and
  what goes to the parking lot. Both fit inside that day's task.
- **No overload.** At most **3 things open** at once. A new idea goes straight to the **parking lot** (`/today park
  <idea>`), never into this week.
- **Missed a day?** Skip it and do today's task. Never double up to catch up. The streak restarts; the plan doesn't.
- **Free channels only.** No paid ads, no bought links or traffic, and nobody you know clicks your ads, ever.

## The 13 weeks
| Week | Days | Theme | The week is done when |
|---|---|---|---|
| 1 | 1–7 | {{W1_THEME}} | {{W1_DONE}} |
| 2 | 8–14 | {{W2_THEME}} | {{W2_DONE}} |
| 3 | 15–21 | {{W3_THEME}} | {{W3_DONE}} |
| 4 | 22–28 | {{W4_THEME}} | {{W4_DONE}} |
| 5 | 29–35 | {{W5_THEME}} | {{W5_DONE}} |
| 6 | 36–42 | {{W6_THEME}} | {{W6_DONE}} |
| 7 | 43–49 | {{W7_THEME}} | {{W7_DONE}} |
| 8 | 50–56 | {{W8_THEME}} | {{W8_DONE}} |
| 9 | 57–63 | {{W9_THEME}} | {{W9_DONE}} |
| 10 | 64–70 | {{W10_THEME}} | {{W10_DONE}} |
| 11 | 71–77 | {{W11_THEME}} | {{W11_DONE}} |
| 12 | 78–84 | {{W12_THEME}} | {{W12_DONE}} |
| 13 | 85–90 | {{W13_THEME}} | {{W13_DONE}} |

Typical arc [P]: foundations (Search Console, Bing Webmaster Tools, trust pages) → wave-1 pages → internal links and
fixes from Search Console → wave 2 → outreach to sites that list similar resources → helpful answers in communities
that allow it → refresh what's getting impressions → AdSense readiness check (only when the gate passes).

## Week 1, day by day
| Day | Task | Minutes | Done when |
|---|---|---|---|
| 1 | {{D1_TASK}} | {{D1_MIN}} | {{D1_DONE}} |
| 2 | {{D2_TASK}} | {{D2_MIN}} | {{D2_DONE}} |
| 3 | {{D3_TASK}} | {{D3_MIN}} | {{D3_DONE}} |
| 4 | {{D4_TASK}} | {{D4_MIN}} | {{D4_DONE}} |
| 5 | {{D5_TASK}} | {{D5_MIN}} | {{D5_DONE}} |
| 6 | {{D6_TASK}} | {{D6_MIN}} | {{D6_DONE}} |
| 7 | {{D7_TASK}} | {{D7_MIN}} | {{D7_DONE}} |

All 90 days are in `growth/plan.json`; this page shows week 1 so the start is concrete.

## Checkpoints (day 30, 60, 90)
| Measure | Target [P] | Result [M] | Source |
|---|---|---|---|
| Pages published | {{CP_PAGES}} | | sitemap |
| Indexed pages | {{CP_INDEXED}} | | Search Console (you) |
| Organic clicks in the last 7 days | {{CP_CLICKS}} | | Search Console (you) |
| Tasks done / 30 | — | | `growth/plan.json` |

At each checkpoint: keep what moved a number, drop what didn't, and pull at most 3 ideas from the parking lot into the
next 30 days.

## Parking lot
Ideas wait here (`growth/plan.json` → `parkingLot`) until a Friday review picks them. Nothing here is a commitment.
