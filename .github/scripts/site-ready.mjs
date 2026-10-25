// Template mode (docs/CONTRACT.md): the site jobs (build, lint, typecheck, e2e, Lighthouse, pre-production gates,
// deploys) run only once a project exists. On the template itself, and in a new copy before /start and Step C, they
// skip instead of failing, while the template's own checks (tests, helper self-tests, gitleaks, Semgrep, npm audit)
// still run. No dependencies.
//
//   node .github/scripts/site-ready.mjs        writes `ready` and `reason` to $GITHUB_OUTPUT (or prints them)
//
// A project exists when factory.config.json → project.domain is set (by /start) and every file the site's npm
// scripts call with `node <file>` is in the repository (Step C, docs/TODO-step-c.md).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeOutputs } from './target-url.mjs';

/** The npm scripts the site jobs run. */
export const SITE_SCRIPTS = ['check:repo', 'audit', 'lint', 'typecheck', 'build', 'test:e2e'];

/** Files an npm script runs with `node <file>` ("node a.mjs && node b.mjs build" → ["a.mjs", "b.mjs"]). */
export function scriptFiles(command) {
  return [...String(command ?? '').matchAll(/\bnode\s+([^\s&|;]+\.m?js)\b/g)].map((m) => m[1]);
}

/** { ready, reason } for a project config, its package.json and a file-exists check. */
export function siteReady({ config, pkg, exists }) {
  const domain = String(config?.project?.domain ?? '').trim();
  if (!domain) {
    return { ready: false, reason: 'template mode: factory.config.json project.domain is empty (no project yet; run /start)' };
  }
  const scripts = pkg?.scripts ?? {};
  const missingScripts = SITE_SCRIPTS.filter((s) => !scripts[s]);
  if (missingScripts.length) return { ready: false, reason: `template mode: package.json has no ${missingScripts.join(', ')} script` };
  const missingFiles = [...new Set(SITE_SCRIPTS.flatMap((s) => scriptFiles(scripts[s])))].filter((f) => !exists(f));
  if (missingFiles.length) {
    return { ready: false, reason: `template mode: the site isn't built yet (missing ${missingFiles.join(', ')}; see docs/TODO-step-c.md)` };
  }
  return { ready: true, reason: `project ${domain}: site jobs run` };
}

if (!!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const r = siteReady({ config: read('factory.config.json'), pkg: read('package.json'), exists: existsSync });
  console.log(`${r.ready ? '' : '::notice::'}${r.reason}`);
  writeOutputs({ ready: String(r.ready), reason: r.reason.replace(/[\r\n]+/g, ' ') });
}
