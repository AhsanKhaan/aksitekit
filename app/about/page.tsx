import Link from 'next/link';
import TrustPage from '@/components/TrustPage';
import { registry } from '@/lib/registry';
import { SITE, authorPath } from '@/lib/site';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

const path = '/about/';
const description = `Who runs ${SITE.name}, what it covers, how its pages are written and checked, and how to reach the people behind it.`;
export const metadata = pageMetadata({ title: titleFor(`About ${SITE.name}: who runs it and why`, `About ${SITE.name}: who runs it`, `About ${SITE.name}`), description, path });

export default function About() {
  const { categories } = registry();
  return (
    <TrustPage path={path} name={`About ${SITE.name}`} description={description} type="AboutPage">
      <p className="lead">{SITE.tagline}</p>
      <h2>Who runs it</h2>
      <p>
        {SITE.owner.name} runs {SITE.name}. {SITE.owner.about} The pages are written and checked by{' '}
        <Link href={authorPath}>{SITE.author.name}</Link>, whose page lists what they know and how to reach them.
      </p>
      <h2>What you will find here</h2>
      <p>Each section answers one family of questions, with a working tool where one helps:</p>
      <ul>
        {categories.map((c) => (
          <li key={c.url}>
            <Link href={c.url}>{c.name}</Link>: {c.description}
          </li>
        ))}
      </ul>
      <h2>How the pages are made</h2>
      <p>
        Topics come from research into what people search for, so each page answers a question someone asked. Every
        fact on a page comes from a source named on that page, and every tool is tested against worked examples before
        it goes live. The <Link href="/editorial-policy/">editorial policy</Link> explains the rules in full, including
        how corrections work.
      </p>
      <h2>What the site does with your visit</h2>
      <p>
        {SITE.ga4Id
          ? 'The site counts visits with Google Analytics, and only after you agree where the law asks for consent.'
          : 'The site runs no analytics and sets no cookies.'}{' '}
        {SITE.ads
          ? 'It shows ads from Google AdSense, which never sit inside a tool or its results.'
          : 'It shows no ads.'}{' '}
        Tools work inside your browser, so what you type into them is never sent anywhere. The{' '}
        <Link href="/privacy/">privacy policy</Link> has the details.
      </p>
      <h2>Get in touch</h2>
      <p>
        Spotted a mistake, or want a question answered on a page? Write through the <Link href="/contact/">contact page</Link>.
        Corrections are made quickly and noted on the page they change.
      </p>
    </TrustPage>
  );
}
