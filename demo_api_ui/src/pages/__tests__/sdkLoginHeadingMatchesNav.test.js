import fs from 'node:fs';
import path from 'node:path';

// DaVinci has one sidebar entry: the SDK master lesson. The two runnable lessons
// remain reachable from that page rather than appearing as duplicate nav items.
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('the DaVinci SDK master lesson is named the same thing in the nav and on the page', () => {
  it('h1 text matches the single AdminSideNav label for /davinci-sdk', () => {
    const nav = read('../../components/AdminSideNav.jsx');
    const navLabel = nav.match(
      /label:\s*"([^"]+)",\s*path:\s*"\/davinci-sdk"/,
    )?.[1];
    expect(navLabel, 'AdminSideNav must list /davinci-sdk').toBeTruthy();

    const page = read('../OrchestrationSdkExplainerPage.jsx');
    // the page title is an <h1> or the shared <PageHeader title="..."> (which renders the <h1>)
    const heading = page.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] ?? page.match(/<PageHeader[^>]*\stitle="([^"]+)"/)?.[1];
    expect(heading, 'DaVinci SDK master lesson must have an h1').toBeTruthy();

    expect(heading.trim()).toBe(navLabel.trim());
  });
});

// Not asserted here: that navStructureCatalog carries the same label. It stores
// bare label strings with no paths, and navStructureCatalog.drift.test.js
// already gates catalog-vs-nav agreement.
