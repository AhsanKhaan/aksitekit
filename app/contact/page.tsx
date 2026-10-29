import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { SITE } from '@/lib/site';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

const path = '/contact/';
const description = `How to contact ${SITE.name}: the email address, what to include in a message, and how soon you can expect a reply.`;
export const metadata = pageMetadata({ title: titleFor(`Contact ${SITE.name}: email and reply times`, `Contact ${SITE.name}`), description, path });

export default function Contact() {
  return (
    <TrustPage path={path} name="Contact" description={description} type="ContactPage">
      <p className="lead">
        Email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. A person reads every message and replies
        within {SITE.contactDays} working days.
      </p>
      <h2>What to write about</h2>
      <ul>
        <li>A mistake on a page: name the page and the line, and the source you checked it against if you have one.</li>
        <li>A tool that gives a result you didn&apos;t expect: tell us what you typed and what you expected to see.</li>
        <li>A question a page doesn&apos;t answer yet: it may become a new section or a new page.</li>
        <li>Anything about your privacy or your data: see the <Link href="/privacy/">privacy policy</Link> first, then write.</li>
      </ul>
      <h2>What happens next</h2>
      <p>
        Corrections are checked against a primary source, made on the page, and the page&apos;s updated date changes with
        them. The <Link href="/editorial-policy/">editorial policy</Link> describes how that works. Messages are used only
        to reply to you and are deleted once the matter is closed.
      </p>
      <h2>Why there is no form</h2>
      <p>
        The site is a set of static pages with no server of its own, which keeps it fast and leaves nothing to break
        into. Email is the simplest way to reach a person without handing your details to another service.
      </p>
      <p>
        Security researchers can find the reporting address in the site&apos;s{' '}
        <a href="/.well-known/security.txt">security.txt file</a>.
      </p>
    </TrustPage>
  );
}
