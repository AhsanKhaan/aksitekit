# AK Site Kit

Built with [Claude Code](https://code.claude.com). Not affiliated with or endorsed by Anthropic.

A starter kit for building websites that can rank on Google and earn with AdSense. You bring your keyword research; a
team of Claude Code helpers turns it into a plan, a design and then the site, and checks everything before it goes
live. Free tools only.

## What you need
- A GitHub account.
- [Claude Code](https://code.claude.com) (the desktop app or the terminal).
- [Node.js](https://nodejs.org) 24, which comes with npm.
- Google Keyword Planner (free with a Google Ads account), to download keyword ideas for your competitors.
- Later, to put the site online: a free Cloudflare account and a domain.

## Start a website in 5 steps
1. On this repository's GitHub page, click **Use this template → Create a new repository**. (Use the template, not
   Fork: your new site starts clean, without this kit's history.)
2. Download (clone) your new repository to your computer.
3. In its folder, run this once to install everything:
   ```bash
   npm ci
   ```
4. Open the folder in Claude Code. If it asks you to trust the repository, say yes.
5. Type **`/start`** and answer the questions.

`/start` remembers where you stopped. Run it again any time to carry on.

## What `/start` asks you
- **Your website:** its domain and name.
- **Your competitors:** 2 to 5 websites, each with its Domain Rating (DR) from a free checker. The weakest one becomes
  your keyword starting point, because its keywords are the ones a new site can win.
- **Technology:** Next.js (built in, the default) or another one you prefer.
- **Your keyword lists:** one Keyword Planner download per competitor. `/start` tells you exactly where to click and
  where to save the file.

It asks before anything that costs money, and before every launch.

## What you get
- **A keyword map:** the pages to build, each aimed at one search people really make. Keywords that are seasonal or
  too hard to rank for are left out.
- **A content plan,** with a short brief for every page.
- **A site plan and a design:** colours, fonts and layout, improving on what your competitors do.
- **A 90-day growth plan,** one small task a day. Type **`/today`** to see just today's task.
- **Checks before launch:** SEO, AdSense rules, security, speed and phones. Nothing goes live until they pass and you
  say go.

**Status:** the step that builds the website itself (the starter site), and most of the automatic checks that run on
it, are still being added. Today, `/start` takes you from keyword research to a finished plan and design.

## Good to know
- **Free tools only.** If a step would need a paid tool, it stops and asks you first, and offers a free option.
- **No copying.** It studies competitors to find what they miss; it never copies their words or design.
- **You stay in charge.** Every launch needs your OK for that exact version.

## More detail
- [docs/HANDBOOK.md](docs/HANDBOOK.md): how everything works (the pipeline, the helpers, every check, CI, scripts).
- [research/inputs/README.md](research/inputs/README.md): downloading keyword ideas from Keyword Planner.
- [.github/README.md](.github/README.md): setting up automatic checks and deployment on GitHub and Cloudflare.
- [CLAUDE.md](CLAUDE.md): the rules the helpers follow.
