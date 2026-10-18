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
    // Title is either an inline <h1> or <PageHeader title="…" /> (which renders the h1).
    const headerTitle = page.match(/<PageHeader\b[^>]*?\btitle=(?:"([^"]+)"|\{\s*['"]([^'"]+)['"]\s*\}|\{(\w+)\})/);
    const constName = headerTitle?.[3];
    const constValue = constName
      ? page.match(new RegExp(`const\\s+${constName}\\s*=\\s*['"]([^'"]+)['"]`))?.[1]
      : undefined;
    const heading =
      page.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] ??
      headerTitle?.[1] ?? headerTitle?.[2] ?? constValue;
    expect(heading, 'DaVinci SDK master lesson must have an h1 or a PageHeader title').toBeTruthy();

    expect(heading.trim()).toBe(navLabel.trim());
  });
});

// Not asserted here: that navStructureCatalog carries the same label. It stores
// bare label strings with no paths, and navStructureCatalog.drift.test.js
// already gates catalog-vs-nav agreement.
