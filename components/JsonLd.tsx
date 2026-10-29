import { serializeJsonLd } from '@/lib/seo/jsonld';

/**
 * The ONE allowed use of dangerouslySetInnerHTML (eslint.config.mjs). The data goes through serializeJsonLd(), which
 * escapes "<", ">" and "&", so no content can close the script tag. JSON-LD is a data block, so CSP script-src
 * doesn't apply to it.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
