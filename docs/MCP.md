# MCP servers

`.mcp.json` lists **official, free servers only**. Claude Code asks each person to approve a project server the first
time it starts, so nothing connects without your yes. Accounts are always connected **by the owner** (OAuth in the
browser through `/mcp`, or an environment variable you set yourself); agents never log in or handle tokens.

Checked on 2026-10-25. Versions are pinned to releases at least 7 days old (the repo's `min-release-age=7` rule).

## Enabled (free)
| Server (`.mcp.json` name) | Publisher and source | Transport and pin | Auth | Access | Used by |
|---|---|---|---|---|---|
| `cloudflare-docs` | Cloudflare, `cloudflare/mcp-server-cloudflare` | HTTP `https://docs.mcp.cloudflare.com/mcp` | none | read | architect, cloudflare-reviewer |
| `cloudflare-api` | Cloudflare, `cloudflare/mcp` (Code Mode: `search`, `execute`, `whoami`) | HTTP `https://mcp.cloudflare.com/mcp` | OAuth by the owner (`/mcp`) | **reads free; every write asks the owner** (the guard hook turns any non-GET call into a permission prompt and refuses DELETE) | cloudflare-reviewer, devsecops-deployer |
| `github` | GitHub, `github/github-mcp-server` | HTTP `https://api.githubcopilot.com/mcp/readonly` (read-only tool set) | `GITHUB_PERSONAL_ACCESS_TOKEN` env var, set by the owner | read | devsecops-deployer (CI status), orchestrator |
| `playwright` | Microsoft, `microsoft/playwright-mcp` | stdio `npx @playwright/mcp@0.0.83 --headless --isolated --block-service-workers --blocked-origins <ad hosts>` | none | local browser | competitor-recon, harness, responsive-checker |
| `chrome-devtools` | Google Chrome DevTools, `ChromeDevTools/chrome-devtools-mcp` | stdio `npx chrome-devtools-mcp@1.11.0 --headless --isolated --no-usage-statistics` | none | local browser | performance-auditor |
| `google-analytics` | Google Analytics, `googleanalytics/google-analytics-mcp` | stdio `pipx run --spec analytics-mcp==0.7.0 analytics-mcp` (needs Python and pipx) | Google Application Default Credentials with the `analytics.readonly` scope, set up by the owner | **read-only** (writes need `--allow-write`, which we never pass) | growth-strategist, after launch |
| `claude-docs` | Anthropic, Claude Code docs | HTTP `https://code.claude.com/docs/mcp` | none | read | any agent with a Claude Code question |

### Why these flags
- Playwright runs headless with an in-memory profile, and **blocks the main ad-serving origins** so recon and tests
  never create ad impressions on anyone's site (AdSense invalid-traffic rules).
- Chrome DevTools sends usage statistics to Google by default; `--no-usage-statistics` turns that off.
- GitHub uses the remote server's `/readonly` URL: agents read CI runs and PRs; merging is the owner's (or `gh` after a
  GO).

## Setup (owner)
1. **Cloudflare:** run `/mcp`, pick `cloudflare-api`, log in in the browser, grant the smallest set of permissions the
   reviewer needs (zone and DNS read, Pages read; add edit scopes only when you approve a specific fix). The docs
   server needs nothing.
2. **GitHub:** create a fine-grained personal access token for this repository only, read-only (contents, pull
   requests, actions, metadata), with an expiry. Set it as the user environment variable `GITHUB_PERSONAL_ACCESS_TOKEN`
   in your shell profile, never in a file in this repository. Without it, the server simply fails to connect.
   If the remote server isn't available to your account [U: GitHub's terms can change], the same server runs locally
   for free: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN -e GITHUB_READ_ONLY=1 ghcr.io/github/github-mcp-server`
   (add it with `claude mcp add --scope local`).
3. **Google Analytics:** only after launch and only if you want the growth plan re-planned from real numbers. Install
   pipx, run `gcloud auth application-default login --scopes https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform`,
   and set `GOOGLE_PROJECT_ID` in your environment. Leave it unconnected otherwise.
4. **Windows:** `npx` and `pipx` servers need the `cmd /c` wrapper on native Windows. Add a local override for each,
   for example:
   ```bash
   claude mcp add --scope local playwright -- cmd /c npx -y @playwright/mcp@0.0.83 --headless --isolated --block-service-workers
   ```
   A local server with the same name takes precedence over the project one [U: check `claude mcp list`].

## Listed but off (paid)
These are official servers, but they need a paid plan or paid API units. They are **not** in `.mcp.json`. Agents
never suggest connecting them; if a step seems to need one, they stop and ask, and propose the free route.

| Server | Why it's off | Free route instead |
|---|---|---|
| Semrush MCP | Needs a paid Semrush subscription with API units | Keyword Planner CSVs (owner), the free SERP check |
| Ahrefs MCP | Needs a paid Ahrefs plan with API access | The owner supplies DR from a free checker; the free SERP check for KD |
| DataForSEO MCP (used by some claude-seo sub-agents) | Pay-per-request API | Skip those sub-agents; use the free checks |
| `anthropics/claude-code-action` (Claude in CI) | Needs a paid Anthropic API key | CI runs the free deterministic scripts only |

## Not available
- **Google Search Console:** there is **no official Search Console MCP server** (blueprint check, 2026-10-25; re-check
  before relying on it [U]). Search
  Console steps (property, sitemap submission, the Performance report, URL inspection) stay manual for the owner, who
  shares numbers or screenshots when an agent needs them. Community servers exist; they aren't on the trusted list.
- **Google AdSense:** no MCP is used. Agents never act in the AdSense account.

## Adding a server
Only an official server from the publisher of the service, free to use, pinned to an exact version or a fixed URL,
added to `skills.lock.json` (its source repo and commit) and to this file, with the owner's yes. Read-only by default.
