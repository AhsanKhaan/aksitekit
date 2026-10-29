import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { SITE } from '@/lib/site';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

const path = '/privacy/';
const description = `What ${SITE.name} collects when you visit, which cookies it sets and why, who processes the data, and how to ask about it.`;
export const metadata = pageMetadata({ title: titleFor(`Privacy policy: what ${SITE.name} collects`, `Privacy policy for ${SITE.name}`, 'Privacy policy: what this site collects'), description, path });

/** Written from what the build actually runs (lib/site.ts): analytics and ads paragraphs appear only when they're on. */
export default function Privacy() {
  return (
    <TrustPage path={path} name="Privacy policy" description={description}>
      <p className="lead">
        This page lists everything {SITE.name} collects, and nothing else is collected. {SITE.ga4Id || SITE.ads ? '' : 'Today that is only the record any web host keeps of each request.'}
      </p>
      <h2>Hosting records</h2>
      <p>
        Pages are served by <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Cloudflare</a>. Like any host,
        it records each request: your IP address, your browser&apos;s name and version, the page asked for and the time.
        Cloudflare uses these records to deliver the page and to block attacks, and keeps them for a short time under its
        own policy. The owner sees only totals.
      </p>
      <h2>Tools and what you type</h2>
      <p>
        Tools run inside your browser. What you type into them stays on your device and is never sent to a server or to
        anyone else.
      </p>
      {SITE.ga4Id ? (
        <>
          <h2>Analytics</h2>
          <p>
            The site uses <a href="https://policies.google.com/privacy" rel="noopener">Google Analytics</a> to count visits
            and see which pages are read. In the European Economic Area, the UK and Switzerland it waits for you to accept;
            elsewhere it runs unless you turn it off with Cookie settings at the bottom of every page. It sets the _ga cookies,
            receives page addresses without anything after a question mark, and never receives what you type into a tool.
            Your choice is kept in your browser under the name site-consent for up to a year.
          </p>
        </>
      ) : (
        <>
          <h2>Cookies and analytics</h2>
          <p>No cookies are set and no analytics run, so there is nothing to accept or decline.</p>
        </>
      )}
      {SITE.ads ? (
        <>
          <h2>Advertising</h2>
          <p>
            The site shows ads from Google AdSense. Google and its partners use advertising cookies to show and measure ads,
            and, where you agree, to choose ads from your interests. Visitors in the European Economic Area, the UK and
            Switzerland are asked first through a consent message from a Google-certified consent platform. You can manage
            ad personalisation in <a href="https://adssettings.google.com/" rel="noopener">Google&apos;s ad settings</a>.
          </p>
        </>
      ) : (
        <>
          <h2>Advertising</h2>
          <p>There are no ads. If that changes, this page will say so before the first one appears.</p>
        </>
      )}
      <h2>Email</h2>
      <p>
        If you send an email, your message and address are used only to reply, and deleted once the matter is closed.
      </p>
      <h2>Security</h2>
      <p>
        Every page is sent over an encrypted HTTPS connection. The pages load no scripts from other companies unless this
        policy names them above, and their response headers stop other websites from showing them inside a frame.
      </p>
      <h2>Children</h2>
      <p>These pages are a general reference for adults and don&apos;t knowingly collect anything from children.</p>
      <h2>Your rights and questions</h2>
      <p>
        You can ask what is held about you, or ask for it to be deleted, through the <Link href="/contact/">contact page</Link>.
        When this policy changes, the date at the top of the page changes with it.
      </p>
    </TrustPage>
  );
}
