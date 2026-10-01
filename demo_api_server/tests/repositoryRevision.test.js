'use strict';

const path = require('node:path');
const { readRepositoryRevision } = require('../utils/repositoryRoot');

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const reader = (files) => (file) => {
  const key = path.relative(path.join('/checkout', '.git'), file);
  if (!(key in files)) throw new Error('ENOENT');
  return files[key];
};
const read = (files, env = {}) => readRepositoryRevision('/checkout', { env, readFileSync: reader(files) });

describe('readRepositoryRevision', () => {
  it('resolves a branch HEAD through its loose ref', () => {
    expect(read({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': SHA + '\n' })).toBe(SHA);
  });

  it('falls back to packed-refs when the ref has no loose file', () => {
    expect(read({ HEAD: 'ref: refs/heads/main\n', 'packed-refs': `# pack-refs\n${OTHER} refs/heads/other\n${SHA} refs/heads/main\n` })).toBe(SHA);
  });

  it('returns a detached HEAD as is', () => {
    expect(read({ HEAD: SHA + '\n' })).toBe(SHA);
  });

  it('prefers a revision declared by the build', () => {
    expect(read({ HEAD: SHA }, { GIT_COMMIT: OTHER })).toBe(OTHER);
  });

  it('returns null when there is no readable checkout or the ref is unknown', () => {
    expect(read({})).toBeNull();
    expect(read({ HEAD: 'ref: refs/heads/main' })).toBeNull();
  });
});
