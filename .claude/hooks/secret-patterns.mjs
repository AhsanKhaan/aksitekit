// Secret patterns shared by the hooks and the gate runner. Matches are reported by rule name and line only; the
// matched value is never printed. This is a fast guard after each edit, not a replacement for gitleaks in CI.

export const SECRET_RULES = [
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{60,})\b/ },
  { name: 'Google API key', re: /\bAIza[\w-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Slack webhook', re: /https:\/\/hooks\.slack\.com\/services\/[\w/-]{20,}/ },
  { name: 'Stripe live key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Anthropic or OpenAI key', re: /\bsk-(?:ant-|proj-)[\w-]{20,}/ },
  {
    name: 'Cloudflare deploy hook URL',
    re: /https:\/\/api\.cloudflare\.com\/client\/v4\/pages\/webhooks\/deploy_hooks\/[0-9a-f-]{20,}/,
  },
  {
    name: 'Cloudflare API token assignment',
    re: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CLOUDFLARE_API_KEY)\s*[:=]\s*["']?[\w-]{30,}/,
  },
  {
    name: 'hard-coded credential',
    re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d)["']?\s*[:=]\s*["']([^"'\s]{16,})["']/i,
    skip: (m) => /^[$<{%]|\$\{|\{\{|process\.env|example|placeholder|your[_-]|x{6,}|\*{4,}/i.test(m[1] ?? ''),
  },
];

/** Returns [{ rule, line }] for every match in `text`; values are never returned. */
export function findSecrets(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of SECRET_RULES) {
      const m = lines[i].match(rule.re);
      if (m && !(rule.skip && rule.skip(m))) hits.push({ rule: rule.name, line: i + 1 });
    }
  }
  return hits;
}

/** Replaces anything that looks like a secret with [REDACTED] (for ledger evidence and logs). */
export function redact(text) {
  let out = text;
  for (const rule of SECRET_RULES) {
    if (rule.skip) continue;
    out = out.replace(new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g'), '[REDACTED]');
  }
  return out;
}

// `.env.example` is the committed template; every other .env* file (and wrangler's .dev.vars) is the owner's.
const SECRET_FILE = /(?:^|[\\/])(?:\.env(?!\.example$)(?:\.[^\\/]*)?|\.dev\.vars(?:\.[^\\/]*)?)$/i;
const SECRET_PATHS = [
  /(?:^|[\\/])\.ssh[\\/]/i,
  /(?:^|[\\/])\.aws[\\/]credentials$/i,
  /(?:^|[\\/])\.wrangler[\\/]config[\\/]/i,
  /(?:^|[\\/])\.config[\\/]gh[\\/]hosts\.ya?ml$/i,
  /(?:^|[\\/])\.config[\\/]gcloud[\\/]/i,
  /(?:^|[\\/])\.docker[\\/]config\.json$/i,
  /(?:^|[\\/])\.netrc$/i,
  /(?:^|[\\/])(?:secrets|\.secrets)[\\/]/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

/** True when a path names a secrets file that agents must not read or write. */
export function isSecretPath(p) {
  if (!p) return false;
  const s = String(p).replace(/["']/g, '');
  return SECRET_FILE.test(s) || SECRET_PATHS.some((re) => re.test(s));
}
