import fs from 'node:fs';
import path from 'node:path';

// The side-nav label and the page's own <h1> are two separate strings that have
// to agree, and they drifted: the nav was renamed to "Orchestration SDK Login"
// while the page kept saying "DaVinci SDK Login". Clicking the orchestration
// entry then landed on a page that did not look like the orchestration app —
// reported as "I do not see a way to start the orchestration app, I only see
// widget", when in fact the page was working the whole time.
//
// A string read rather than a render: the page calls fetch and boots the SDK on
// mount, and none of that is needed to compare two labels.
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('the SDK login page is named the same thing in the nav and on the page', () => {
  it('h1 text matches the AdminSideNav label for /davinci-sdk-login', () => {
    const nav = read('../../components/AdminSideNav.jsx');
    const navLabel = nav.match(
      /label:\s*"([^"]+)",\s*path:\s*"\/davinci-sdk-login"/,
    )?.[1];
    expect(navLabel, 'AdminSideNav must list /davinci-sdk-login').toBeTruthy();

    const page = read('../DavinciSdkLoginPage.jsx');
    const heading = page.match(/<h1 className="dvsdk-title">([^<]+)<\/h1>/)?.[1];
    expect(heading, 'DavinciSdkLoginPage must render an h1').toBeTruthy();

    expect(heading.trim()).toBe(navLabel.trim());
  });
});

// Not asserted here: that navStructureCatalog carries the same label. It stores
// bare label strings with no paths, and navStructureCatalog.drift.test.js
// already gates catalog-vs-nav agreement.
