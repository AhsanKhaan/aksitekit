// The HTML and URL helpers behind the gates (scripts/lib/html.mjs), and the CodeQL fixes that use them: each planted
// case is one a regex filter or an unanchored host pattern got wrong.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adCodeIn } from '../../scripts/check-out.mjs';
import { decodeEntities, elementsOf, hostIs, hostOfUrl, hostsIn, htmlText, jsonLdScripts, mentionsHost, tokenize } from '../../scripts/lib/html.mjs';
import { readTracked } from '../../internal/scripts/check-repo.mjs';
import { DNS_LABEL, DNS_NAME, endpointProblem, xssEchoed } from '../../internal/scripts/check-security.mjs';
import { isGtagLoad } from '../../internal/scripts/audits/ga-live.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('decodeEntities', () => {
  it('decodes in one pass: "&amp;lt;" is the text "&lt;", never "<" (double unescaping)', () => {
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(decodeEntities('a &lt;b&gt; &quot;c&quot; &#39;d&#x27; &nbsp;e&#160;f')).toBe('a <b> "c" \'d\'  e f');
    expect(decodeEntities('&unknown; &#0; &#x110000;')).toBe('&unknown; &#0; &#x110000;');
  });
});

describe('tokenize and htmlText', () => {
  it('closes a script at any end tag the HTML parser accepts ("</script >", "</SCRIPT\\n>", "</script foo>")', () => {
    for (const end of ['</script >', '</SCRIPT\n>', '</script foo="bar">', '</script\t>']) {
      expect(htmlText(`<p>before</p><script>var x = "<p>hidden</p>";${end}<p>after</p>`)).toBe('before after');
    }
    expect(htmlText('<p>a</p><script>if (a < b) {}</script><p>b</p>')).toBe('a b');
    expect(htmlText('<p>a</p><scripts>b</scripts>')).toBe('a b'); // not a script element
  });

  it('ends a comment at "-->" or "--!>"', () => {
    expect(htmlText('a<!-- x -->b')).toBe('a b');
    expect(htmlText('a<!-- x --!>b')).toBe('a b');
    expect(htmlText('a<!-- never closed')).toBe('a');
  });

  it('removes every tag, including nested and broken ones (multi-character sanitization)', () => {
    // The result is text: a stray "<" may remain as a character, but no markup survives a second parse.
    const t = htmlText('<<p>script>alert(1)<</p>/script><img src=x onerror=alert(1)>');
    expect(tokenize(t).every((k) => k.type === 'text')).toBe(true);
    expect(t).not.toMatch(/<img|onerror/i);
    expect(htmlText('<a title="x > y">link</a>')).toBe('link'); // ">" inside a quoted attribute
    expect(htmlText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2'); // stray "<" is text
  });

  it('skips script, style, svg, noscript and template, and any element asked for, nested or not', () => {
    expect(htmlText('<p>a</p><svg><title>icon</title></svg><template><p>t</p></template><noscript>n</noscript><p>b</p>')).toBe('a b');
    expect(htmlText('<main><nav><nav>x</nav>y</nav><p>z</p></main>', { drop: ['nav'] })).toBe('z');
    expect(htmlText('<p>a</p><p>b</p>br<br>c', { blocks: true })).toBe('a . b . br . c');
    expect(htmlText('<a><span>Pets</span><span>1</span></a>', { sep: '' })).toBe('Pets1');
  });

  it('finds elements and JSON-LD by the same end-tag rule', () => {
    const html = '<head><script type="application/ld+json">{"a":1}</script ><script src="/x.js"></script></head><main id="m"><main>inner</main></main>';
    expect(jsonLdScripts(html)).toEqual(['{"a":1}']);
    expect(elementsOf(html, 'script').map((s) => s.attrs.trim())).toEqual(['type="application/ld+json"', 'src="/x.js"']);
    expect(elementsOf(html, 'main')[0]?.inner).toBe('<main>inner</main>');
    expect(tokenize('<br/>').map((t) => t.type)).toEqual(['start']);
  });
});

describe('host checks (no unanchored host patterns)', () => {
  it('matches a host and its subdomains only', () => {
    expect(hostIs('www.googletagmanager.com', 'googletagmanager.com')).toBe(true);
    expect(hostIs('googletagmanager.com', 'googletagmanager.com')).toBe(true);
    expect(hostIs('evilgoogletagmanager.com', 'googletagmanager.com')).toBe(false);
    expect(hostIs('googletagmanager.com.evil.net', 'googletagmanager.com')).toBe(false);
  });

  it('reads hosts from URLs and CSP sources, not from paths or query strings', () => {
    expect(hostOfUrl('https://a.example.com/x')).toBe('a.example.com');
    expect(hostOfUrl('//cdn.example.com/x.js')).toBe('cdn.example.com');
    expect(hostOfUrl('/local/path')).toBe('');
    expect([...hostsIn("script-src 'self' https://www.googletagmanager.com *.google-analytics.com; img-src data:")]).toEqual(['www.googletagmanager.com', 'google-analytics.com']);
    expect(mentionsHost('<a href="https://evil.net/?u=googlesyndication.com">x</a>', 'googlesyndication.com')).toBe(false);
    expect(mentionsHost('<a href="https://evil.net/googletagmanager.com/gtag/js">x</a>', 'googletagmanager.com')).toBe(false);
    expect(mentionsHost('<script src="https://pagead2.googlesyndication.com/pagead/js"></script>', 'googlesyndication.com')).toBe(true);
  });

  it('ad code: the AdSense slot class or a URL on an ad host, never a look-alike', () => {
    expect(adCodeIn('<ins class="adsbygoogle"></ins>')).toBe('adsbygoogle');
    expect(adCodeIn('<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>')).toBe('securepubads.g.doubleclick.net');
    expect(adCodeIn('<p>We never use notdoubleclick.net.example or https://example.com/googleadservices.com</p>')).toBeNull();
  });

  it('GA: only the gtag.js loader on www.googletagmanager.com counts', () => {
    expect(isGtagLoad('https://www.googletagmanager.com/gtag/js?id=G-ABCD1234')).toBe(true);
    expect(isGtagLoad('https://www.googletagmanager.com.evil.net/gtag/js')).toBe(false);
    expect(isGtagLoad('https://evil.net/www.googletagmanager.com/gtag/js')).toBe(false);
    expect(isGtagLoad('not a url')).toBe(false);
  });
});

describe('check-security: nothing but a DNS name or a plain path leaves the machine', () => {
  it('xssEchoed flags a dangerous payload echoed verbatim, by substring, case-insensitively', () => {
    expect(xssEchoed('<p>"><SCRIPT>alert(1)</SCRIPT></p>', '"><SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    expect(xssEchoed('<p>hello</p>', 'hello')).toBe(false); // echoed, but harmless
  });

  it('DNS names and labels', () => {
    for (const ok of ['example.com', '_dmarc.example.com', 's1._domainkey.example.co.uk']) expect(DNS_NAME.test(ok), ok).toBe(true);
    for (const bad of ['example', '-a.example.com', 'a b.example.com', 'example.com/x', 'a'.repeat(64) + '.com', 'ex"ample.com']) expect(DNS_NAME.test(bad), bad).toBe(false);
    expect(DNS_LABEL.test('selector1')).toBe(true);
    expect(DNS_LABEL.test('s.1')).toBe(false);
  });

  it('endpoint paths', () => {
    for (const ok of ['/', '/api/contact', '/api/contact/', '/a.b~c_d-e']) expect(endpointProblem(ok), ok).toBeNull();
    for (const bad of ['api', '/a/../b', '/./a', '//evil.net/x', '/a?b=1', '/a b', 'https://evil.net/', '/' + 'a'.repeat(201)]) expect(endpointProblem(bad), bad).toMatch(/not a plain path/);
  });
});

describe('check-repo readTracked (one descriptor: no check-then-use race)', () => {
  it('reads a text file, skips binary or big ones, and returns null for a missing file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'read-tracked-'));
    temps.push(dir);
    writeFileSync(path.join(dir, 'a.md'), 'hello');
    writeFileSync(path.join(dir, 'b.png'), 'x');
    writeFileSync(path.join(dir, 'big.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
    expect(readTracked(path.join(dir, 'a.md').split(path.sep).join('/'))).toBe('hello');
    expect(readTracked(path.join(dir, 'b.png').split(path.sep).join('/'))).toBe('');
    expect(readTracked(path.join(dir, 'big.md').split(path.sep).join('/'))).toBe('');
    expect(readTracked(path.join(dir, 'gone.md').split(path.sep).join('/'))).toBeNull();
  });
});
