// .gitleaks.toml keeps every default rule, and each allowlist stays narrow: one named rule, exact paths and an exact
// value shape, all required together. A wider allowlist would hide real secrets, so this fails before CI does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../research/helpers';

const toml = readFileSync(join(REPO, '.gitleaks.toml'), 'utf8');
const blocks = toml.split(/^\[\[allowlists\]\]$/m).slice(1);
const field = (block: string, key: string) => block.match(new RegExp(`^${key} = (.+)$`, 'm'))?.[1]?.trim();

describe('.gitleaks.toml', () => {
  it('extends the default rules and disables none', () => {
    expect(toml).toMatch(/^\[extend\]\nuseDefault = true$/m);
    expect(toml).not.toMatch(/disabledRules/);
    expect(toml).not.toMatch(/^\[\[rules\]\]/m);
  });

  it('has only narrow allowlists: one rule, anchored paths, anchored values, condition AND', () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(field(block, 'description')).toBeTruthy();
      expect(field(block, 'targetRules')).toMatch(/^\["[a-z0-9-]+"\]$/);
      expect(field(block, 'condition')).toBe('"AND"');
      expect(field(block, 'paths')).toMatch(/^\['''\^[^']+\$'''\]$/);
      expect(field(block, 'regexes')).toMatch(/^\['''\^[^']+\$'''\]$/);
      expect(block).not.toMatch(/^(commits|stopwords|regexTarget) =/m);
    }
  });
});
