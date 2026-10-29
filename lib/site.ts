import config from '@/factory.config.json';
import siteFacts from '@/content/site.json';

/**
 * Site-wide facts, read at build time: the project from factory.config.json, the people and contact details from
 * content/site.json, and the build's environment. The same rules as the gate scripts (scripts/lib/site.mjs):
 * SITE_URL, NEXT_PUBLIC_SITE_URL, then https://project.domain; the template builds against example.com.
 */
const env = process.env;
const domain = String(config.project.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const url = (env.SITE_URL || env.NEXT_PUBLIC_SITE_URL || (domain ? `https://${domain}` : 'https://example.com')).replace(/\/+$/, '');
const indexable = (env.SITE_INDEXABLE || env.NEXT_PUBLIC_INDEXABLE) === 'true';
const production = env.SITE_ENV === 'production' || (env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === (config.hosting.productionBranch || 'main'));
const ga = String(config.analytics.ga4MeasurementId ?? '');

export const SITE = {
  name: String(config.project.brand || config.project.name || '').trim() || 'Example Site',
  url,
  host: new URL(url).host,
  locale: config.project.locale || 'en',
  indexable,
  /** GA4 only in an indexable production build with a measurement ID; previews and local builds never send analytics. */
  ga4Id: indexable && production && /^G-[A-Z0-9]{4,}$/.test(ga) ? ga : '',
  /** Ads only after approval, when the owner switches monetization.adsense.enabled on (CLAUDE.md "Never"). */
  ads: indexable && production && config.monetization.adsense.enabled === true,
  /** The template's own facts: example people and contact details, replaced before a production build. */
  example: siteFacts.example === true,
  tagline: siteFacts.tagline,
  owner: siteFacts.owner,
  author: siteFacts.author,
  contactEmail: siteFacts.contact.email || `contact@${domain || new URL(url).host}`,
  contactDays: siteFacts.contact.responseDays,
  disclaimer: siteFacts.disclaimer,
  trustUpdated: siteFacts.trustUpdated,
} as const;

export const authorPath = `/authors/${SITE.author.slug}/`;

/** An absolute URL on the site; paths keep their trailing slash. */
export const absoluteUrl = (path: string): string => `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;
