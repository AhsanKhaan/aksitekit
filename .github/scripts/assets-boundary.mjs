// Deploy boundary check (README → "What reaches production"), run by the deploy workflows before anything ships:
// the folder that gets uploaded is the build output and nothing else. No dependencies beyond the repo's own
// scripts/lib/site.mjs (one list of source folders for the build gate and the deploy).
//
//   node .github/scripts/assets-boundary.mjs --outdir <build.outputDir> [--wrangler <wrangler.jsonc|json|toml>]
//
// Fails when build.outputDir is a source folder (".", internal/, app/, public/, ...), or, for a Workers deploy, when
// the wrangler config's assets.directory isn't build.outputDir.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outputDirProblem } from '../../scripts/lib/site.mjs';

const norm = (p) => String(p ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');

/** JSON with comments and trailing commas (wrangler.jsonc) → object. Strings are kept intact. */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** assets.directory from a wrangler config's text, or '' when it has none. */
export function assetsDirectory(text, name) {
  if (/\.toml$/i.test(name)) {
    let section = '';
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.replace(/#.*$/, '').trim();
      const h = /^\[([^\]]+)\]$/.exec(s);
      if (h) { section = h[1].trim(); continue; }
      const kv = /^directory\s*=\s*"([^"]*)"$/.exec(s);
      if (kv && section === 'assets') return kv[1];
      const inline = /^assets\s*=\s*\{.*\bdirectory\s*=\s*"([^"]*)"/.exec(s);
      if (inline && section === '') return inline[1];
    }
    return '';
  }
  const cfg = parseJsonc(String(text));
  return typeof cfg?.assets?.directory === 'string' ? cfg.assets.directory : '';
}

/** Every problem with the deploy boundary (empty when it holds). */
export function boundaryProblems({ outdir, wranglerText, wranglerName }) {
  const problems = [];
  const out = norm(outdir);
  const p = outputDirProblem(out);
  if (p) problems.push(p);
  if (wranglerText !== undefined) {
    let dir = '';
    try {
      dir = norm(assetsDirectory(wranglerText, wranglerName ?? 'wrangler.jsonc'));
    } catch (e) {
      problems.push(`${wranglerName}: doesn't parse (${e.message})`);
      return problems;
    }
    if (!dir) problems.push(`${wranglerName}: no assets.directory (Workers static assets need it, set to build.outputDir "${out}")`);
    else if (dir !== out) problems.push(`${wranglerName}: assets.directory "${dir}" is not build.outputDir "${out}"; only the build folder may be uploaded`);
    const dp = dir && outputDirProblem(dir);
    if (dp && dir !== out) problems.push(dp.replace('build.outputDir', `${wranglerName} assets.directory`));
  }
  return problems;
}

if (!!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const wranglerName = opt('--wrangler');
  const problems = boundaryProblems({
    outdir: opt('--outdir') ?? 'out',
    wranglerText: wranglerName ? readFileSync(wranglerName, 'utf8') : undefined,
    wranglerName: wranglerName?.split(/[\\/]/).pop(),
  });
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  console.log(`assets-boundary: OK (only ${norm(opt('--outdir') ?? 'out')}/ is uploaded)`);
}
