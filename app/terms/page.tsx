import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { SITE } from '@/lib/site';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

const path = '/terms/';
const description = `The terms for using ${SITE.name}: general information, no professional advice, links to other sites, and who owns the text.`;
export const metadata = pageMetadata({ title: titleFor(`Terms of use: the rules for ${SITE.name}`, 'Terms of use: the rules for this site'), description, path });

export default function Terms() {
  return (
    <TrustPage path={path} name="Terms of use" description={description}>
      <p className="lead">
        By using {SITE.name} you agree to these terms. They are short on purpose: read them once and you know where you stand.
      </p>
      <h2>General information, not advice</h2>
      <p>
        The pages and tools give general information. They are not professional advice for your situation. Check any
        figure that matters, such as money, health, law or safety, with a qualified person or a primary source before you
        act on it.
      </p>
      <h2>Accuracy and corrections</h2>
      <p>
        Every page is checked against the sources it names, and tools are tested against worked examples. Mistakes still
        happen. If you find one, the <Link href="/contact/">contact page</Link> explains how to report it, and the{' '}
        <Link href="/editorial-policy/">editorial policy</Link> explains how it gets fixed.
      </p>
      <h2>Links to other sites</h2>
      <p>
        Pages link to the sources they rely on. Those sites have their own owners and terms, and {SITE.name} doesn&apos;t
        control what they publish or how they change.
      </p>
      <h2>Who owns the text</h2>
      <p>
        The text, tools and design of {SITE.name} belong to its owner, {SITE.owner.name}. You may quote a short passage with
        a link back to the page. Copying whole pages, or republishing the site&apos;s content as your own, isn&apos;t allowed.
      </p>
      <h2>Availability</h2>
      <p>
        The site is offered as it is, without a promise that it will always be online or free of errors. Pages can change,
        move or be removed as the information they cover changes.
      </p>
      <h2>Changes to these terms</h2>
      <p>
        When the terms change, the date at the top of this page changes too. The <Link href="/privacy/">privacy policy</Link>{' '}
        covers what the site collects.
      </p>
    </TrustPage>
  );
}
