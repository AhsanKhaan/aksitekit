# adsense-site-factory: instructions for coding agents

Stub written in Phase 0; step A expands it. The build contract is `docs/CONTRACT.md`.

## Always
- **Free tools only.** Never use a paid tool, API or plan. If a step needs one, stop and ask the owner first; if the owner
  says no, propose a free alternative.
- **Agents propose, scripts decide.** Every stage writes a file; a deterministic gate (npm script or CI job) passes or
  fails it. Never call a stage done while its gate fails.
- **Trusted sources only:** skills, plugins, MCP servers and GitHub Actions come from `skills.lock.json`, pinned to a commit.
- **Label every number** in docs and content: [M] measured, [R] range, [P] proxy/estimate, [U] unverified.
- **Before saying a change is done, run** `npm run verify`.

## Never
- Commit to `main`, or deploy without the owner's GO for that commit.
- Copy competitors' text, images or design assets (copyright, and AdSense's unoriginal-content policy). Recon is for
  structure and UX gaps, from public pages only.
- Scrape Google results, bypass CAPTCHAs, or automate sites against their terms.
- Use Keyword Planner's "Competition" column as keyword difficulty (it measures advertiser bidding).
- Add AdSense code or `ads.txt` before the AdSense gate passes and the owner is approved.
- Read or print secrets; commit `.env*` files.
