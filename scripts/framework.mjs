// Runs the build or dev command for the technology chosen at /start (factory.config.json → build).
// The npm scripts stay the same for every technology; only build.commands and build.outputDir change.
//
//   node scripts/framework.mjs build     (called by `npm run build`)
//   node scripts/framework.mjs dev       (called by `npm run dev`)
//
// FACTORY_CONFIG=<path> reads another config file (tests).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const fail = (msg) => {
  console.error(`framework: ${msg}`);
  process.exit(1);
};

const mode = process.argv[2];
if (mode !== 'build' && mode !== 'dev') fail('usage: node scripts/framework.mjs build|dev');

let cfg;
try {
  cfg = JSON.parse(readFileSync(process.env.FACTORY_CONFIG || 'factory.config.json', 'utf8'));
} catch (e) {
  fail(`factory.config.json doesn't parse: ${e.message}`);
}
const b = cfg.build || {};
const framework = String(b.framework || '').trim();
if (!framework) fail('build.framework is empty: run /start and choose Next.js (built-in starter) or another technology');

const outputDir = String(b.outputDir || '');
if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(outputDir) || outputDir.split('/').includes('..')) {
  fail('build.outputDir must be a relative folder inside the repo (for example "out" or "dist")');
}

const command = String(b.commands?.[mode] || '').trim();
if (!command) fail(`build.commands.${mode} is empty for "${framework}": the architect sets it (docs/CONTRACT.md)`);

// The command comes from the repository's own config, never from user input or the network.
console.log(`framework: ${framework} ${mode} → ${command}`);
const r = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, SITE_OUTPUT_DIR: outputDir } });
process.exit(r.status ?? 1);
