import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { SITE, authorPath } from '@/lib/site';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

const path = '/editorial-policy/';
const description = `How ${SITE.name} chooses topics, checks facts against named sources, tests its tools, dates its pages and corrects mistakes.`;
export const metadata = pageMetadata({ title: titleFor(`Editorial policy: how ${SITE.name} checks pages`, 'Editorial policy: how pages are checked'), description, path });

export default function EditorialPolicy() {
  return (
    <TrustPage path={path} name="Editorial policy" description={description}>
      <p className="lead">These are the rules every page on {SITE.name} follows, from the first draft to the last correction.</p>
      <h2>Choosing what to write</h2>
      <p>
        Topics come from research into the questions people search for. Each address answers one question, so two pages
        never compete for the same search, and a page is only published once it answers its question in full.
      </p>
      <h2>Facts and sources</h2>
      <p>
        Every fact comes from a source the page names, preferably the primary one: the standard, the official body or the
        original paper. A claim with no source that can be checked is cut, not softened.
      </p>
      <h2>Tools</h2>
      <p>
        Each tool shows how it reaches its answer, and is tested against worked examples, computed by hand and from the
        sources, before it goes live and after every change.
      </p>
      <h2>Who writes and checks</h2>
      <p>
        Pages are drafted with the help of AI writing tools, then <Link href={authorPath}>{SITE.author.name}</Link> checks
        every fact against its source and every tool against its examples before publishing. The author&apos;s name and the
        date of the last real change appear on each page.
      </p>
      <h2>Dates</h2>
      <p>
        A page&apos;s updated date changes only when its text changes, and the sitemap uses the same date. A rebuild of the
        site with no change to a page leaves its date alone.
      </p>
      <h2>Corrections</h2>
      <p>
        Reports through the <Link href="/contact/">contact page</Link> are checked against a primary source. When a page is
        wrong it is fixed, its date changes, and a significant correction is noted on the page.
      </p>
      <h2>Independence</h2>
      <p>
        No company pays to appear on a page or to change what a page says.{' '}
        {SITE.ads ? 'Ads are placed by Google AdSense and never decide what a page covers.' : 'The site shows no ads.'}
      </p>
    </TrustPage>
  );
}
