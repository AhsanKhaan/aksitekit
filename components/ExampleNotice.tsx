/**
 * The visible mark on the template's example pages. data-example-page lets the gates find them in any build output:
 * check-out.mjs and gate:adsense fail a production build or an AdSense review while one remains.
 */
export default function ExampleNotice() {
  return (
    <aside className="example-notice" data-example-page="">
      <p>
        <strong>Example page.</strong> The template ships one page of each type so its build and tests run. A project
        replaces this text with its own, written from the research brief for this address.
      </p>
    </aside>
  );
}
