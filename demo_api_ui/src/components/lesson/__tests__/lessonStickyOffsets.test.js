import fs from 'node:fs';
import path from 'node:path';

// The app's TopNav is position: sticky and --topnav-height tall, and lesson
// pages scroll beneath it. Offsets of 0 or 1rem put three things under the
// bar, all seen in a live screenshot of /davinci-sdk-login:
//   - the lesson sidebar hid its first entry
//   - a section-nav click scrolled the section title to y=0, under the bar
//   - the sticky sign-in card slid under the bar while the Step Inspector grew
//
// A stylesheet read rather than a render: jsdom does no layout, so a render
// cannot see an overlap. What it can pin is that each offset is derived from
// the bar's token.
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('lesson pages keep sticky and scrolled-to content below the sticky TopNav', () => {
  const lesson = read('../lesson.css');

  it('the section nav sticks below the bar', () => {
    const sidebar = rule(lesson, '.lesson-sidebar');
    expect(sidebar).toMatch(/top:\s*var\(--topnav-height/);
    expect(sidebar).toMatch(/height:\s*calc\(100vh - var\(--topnav-height/);
  });

  it('a section scrolled to from the nav lands below the bar', () => {
    expect(rule(lesson, '.lesson-section')).toMatch(/scroll-margin-top:\s*calc\(var\(--topnav-height/);
  });

  it("the SDK page's sticky sign-in card stays below the bar", () => {
    const page = read('../../../pages/DavinciSdkLoginPage.css');
    expect(rule(page, '.dvsdk-live-app')).toMatch(/top:\s*calc\(var\(--topnav-height/);
  });
});
