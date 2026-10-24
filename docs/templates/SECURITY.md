# Security: {{PROJECT_NAME}}

<!-- Template. secops-reviewer fills and maintains it; doc-generator refreshes the status columns from
reports/security.md. Replace every placeholder (double-brace, upper-case names). Probes only ever target this
project's own preview or production hosts. -->

| | |
|---|---|
| Domain | {{DOMAIN}} |
| Hosting | {{HOSTING_TARGET}} |
| Last full review | {{LAST_REVIEW_DATE}} (`reports/security.md`) |

## 1. Threat model
{{THREAT_MODEL_SUMMARY}}

Default for a static export: no server, login, database or uploads, so SQL injection, auth bypass, SSRF and IDOR don't
apply. The real ways in: query parameters parsed in the browser; build-time content rendered into HTML and JSON-LD; the
npm dependency tree and the build; CI (fork PRs are untrusted code); the local preview server; and the owner's
accounts (registrar, host, GitHub, Google, email).

## 2. Baseline gates
| Gate | Command / job | Pass criteria | Status |
|---|---|---|---|
| Secrets | gitleaks CLI over full history and `out/` (`security.yml`) | Zero findings | {{S_SECRETS}} |
| CVEs | `npm run audit` | No unaccepted high/critical; exceptions expire ≤ 90 days | {{S_AUDIT}} |
| SAST | Semgrep Community Edition (`security.yml`) | No unreviewed medium+ finding | {{S_SAST}} |
| Supply chain | checklist, 7-day rule, exact versions, no install scripts | Every new package passes | {{S_SUPPLY}} |
| GitHub Actions | pinned SHAs from `skills.lock.json`, least privilege, no `pull_request_target` + PR checkout | All workflows | {{S_GHA}} |
| CSP and headers | `_headers` tests, `npm run check:live` | As in `docs/ARCHITECTURE.md` §5 | {{S_HEADERS}} |
| Repo hygiene | `npm run check:repo` | No secrets, no `.env` files, no placeholders | {{S_REPO}} |

## 3. The security-check table
Run as `npm run check:security -- <url>` locally and as jobs in `security.yml` and `preprod.yml`. Each check has a
planted failing case in the tests.

| Check | How it's tested (free) | Fails when | Status | Evidence |
|---|---|---|---|---|
| **Attack scan (Burp-style)** | Burp Suite's automated scanner is Professional-only (paid); Community has none. **ZAP by Checkmarx**: `zaproxy/action-baseline` on every PR against the preview URL; `zaproxy/action-full-scan` weekly and before a release | Any medium or high alert not in the reviewed exceptions file | {{C_ZAP}} | {{E_ZAP}} |
| **XSS** | CSP test (no `unsafe-eval`, third parties allow-listed); ESLint `no-unsanitized`; `dangerouslySetInnerHTML` only in the JSON-LD component; the `</script>` escaping test; e2e injects `"><script>`, `javascript:` and event-handler payloads into every allow-listed query parameter; ZAP's XSS rules | A payload runs, or appears unescaped | {{C_XSS}} | {{E_XSS}} |
| **CSRF** | Static site: no endpoint accepts POST. With server code or forms: Origin/Referer check, `SameSite=Lax`/`Strict` cookies, a CSRF token or Turnstile, and a test that a cross-origin POST is refused | A cross-origin POST succeeds | {{C_CSRF}} | {{E_CSRF}} |
| **Path traversal** | Live probes: `/..%2f..%2fetc/passwd`, `/%2e%2e/`, `/..;/`, double-encoded and backslash variants; Semgrep rules on any server code (`path.join` / `fs` fed by request input) | Anything other than a 400/404 without file contents | {{C_TRAVERSAL}} | {{E_TRAVERSAL}} |
| **Rate limiting** | A capped burst (60 requests in 10 s) against the project's own preview, never a third party. Static pages: the CDN absorbs it. Endpoints, forms or Functions: the free rate-limiting rule, expecting `429` | An endpoint keeps answering 200 under the burst | {{C_RATE}} | {{E_RATE}} |
| **Private server URL exposure** | Scan `out/`, JS bundles and source maps for private IP ranges (10/8, 172.16/12, 192.168/16, 127/8), `localhost`, internal hostnames, `*.pages.dev` / `*.workers.dev` preview URLs, keys and tokens; response headers without `x-powered-by`, version banners or `via` leaks; DNS without DNS-only records revealing an origin IP | Any match | {{C_PRIVATE}} | {{E_PRIVATE}} |
| **Served only through the CDN** | Every live response has `server: cloudflare` and `cf-ray` (Cloudflare targets); every web hostname proxied; all resources same-origin or on the CSP allow-list; no direct-to-origin hostname answers | A resource or host bypasses the CDN | {{C_CDN}} | {{E_CDN}} |
| **Email spoofing** | DNS-over-HTTPS: SPF present (`v=spf1 -all` and a null MX for a domain that never sends mail); DKIM when mail is used; DMARC present and ramped `p=none` → `quarantine` → `reject` on the dates in §4; optional MTA-STS and TLS-RPT | SPF, DKIM or DMARC missing, or DMARC stuck at `none` past its review date | {{C_EMAIL}} | {{E_EMAIL}} |

## 4. Ramps (dated)
| Item | Now | Next step | Due |
|---|---|---|---|
| HSTS | {{HSTS_NOW}} | `max-age=86400` at launch → `31536000` after 7 clean days; `includeSubDomains` only if every subdomain serves HTTPS; never `preload` | {{HSTS_DUE}} |
| DMARC | {{DMARC_NOW}} | `p=none` (with reports) → `quarantine` → `reject` | {{DMARC_DUE}} |

## 5. Reviewed exceptions
| Item | Reason | Mitigation | Approved by | Expires (≤ 90 days) |
|---|---|---|---|---|
| {{EXCEPTION_ROWS}} | | | | |

## 6. Secrets and accounts
- Secrets are referred to **by name only**: {{SECRET_NAMES}} (for example `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets). Never in files, logs, issues or chat.
- Tokens are scoped to the minimum (one zone, one project), with an expiry, reviewed monthly.
- 2FA (passkeys or an authenticator) on the registrar, host, GitHub, Google and email; recovery codes offline.
- Branch protection on the production branch: PR required, required checks, no force-push, no deletion.

## 7. Incident playbook
| Incident | First action | Then |
|---|---|---|
| Leaked secret | Revoke and rotate it at the provider | Purge from history if committed; check access logs; note it here |
| Unexpected script or content live | Roll back to the last good deployment | Find the cause (dependency, CI, account); fix forward |
| Unknown DNS record, Worker or token | Owner checks the account at once | Remove after confirming; rotate tokens; review access |
| Invalid-traffic warning or click spike (after AdSense) | Owner turns ads off in production | Analyse sources; report to Google; ads back only once understood |
| Defacement or account takeover | Owner secures the account (password, 2FA, sessions) | Roll back; review every token and OAuth app |

## 8. Status (refreshed by doc-generator)
{{SECURITY_STATUS}}
