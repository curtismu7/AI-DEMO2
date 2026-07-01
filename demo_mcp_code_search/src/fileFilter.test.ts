import { globToMatcher } from './fileFilter';

describe('globToMatcher', () => {
  test('* matches within a path segment but not across separators', () => {
    const m = globToMatcher('*.js');
    expect(m('app.js')).toBe(true);
    expect(m('app.ts')).toBe(false);
    expect(m('src/app.js')).toBe(false); // * does not cross '/'
  });

  test('** matches across path separators', () => {
    const m = globToMatcher('src/**/*.ts');
    expect(m('src/app.ts')).toBe(true);
    expect(m('src/a/b/c.ts')).toBe(true);
    expect(m('lib/app.ts')).toBe(false);
  });

  test('an exact path matches only itself', () => {
    const m = globToMatcher('src/index.ts');
    expect(m('src/index.ts')).toBe(true);
    expect(m('src/index.tsx')).toBe(false);
  });

  test('? matches a single non-separator character', () => {
    const m = globToMatcher('file?.ts');
    expect(m('file1.ts')).toBe(true);
    expect(m('file.ts')).toBe(false);
    expect(m('file12.ts')).toBe(false);
  });

  test('regex metacharacters in the glob are treated literally', () => {
    const m = globToMatcher('a.b+c.ts');
    expect(m('a.b+c.ts')).toBe(true);
    expect(m('axbxc.ts')).toBe(false);
  });
});
