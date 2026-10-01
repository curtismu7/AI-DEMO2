'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { groupServices, imageBuilds, parseRestartLog, parseServedCheckout, readDeployState } = require('./deploy-state');

test('parseRestartLog keeps real deploy lines, newest first, and ignores the rest', () => {
  const log = [
    '2026-10-01T10:19:32Z  deploy 32541ec81b90  restarted: ui demo-api-server ui  ui@2026-10-01T10:19:12Z  demo-api-server@',
    'unknown  ui@2026-10-01T10:19:12.583900508Z',
    '2026-10-01T12:02:56Z  deploy 93919932eecb  restarted: ui  ui@2026-10-01T12:00:54Z',
    '',
  ].join('\n');
  assert.deepEqual(parseRestartLog(log), [
    { at: '2026-10-01T12:02:56Z', sha: '93919932e', services: ['ui'] },
    { at: '2026-10-01T10:19:32Z', sha: '32541ec81', services: ['ui', 'demo-api-server'] },
  ]);
  assert.deepEqual(parseRestartLog(log, 1).map((entry) => entry.sha), ['93919932e']);
});

test('parseServedCheckout tells the main checkout from a served worktree', () => {
  const served = parseServedCheckout('BFF  main checkout   /repo/demo_api_server\nUI   my-worktree   /repo/.claude/worktrees/my-worktree/demo_api_ui\n');
  assert.deepEqual(served.map((mount) => [mount.mount, mount.checkout, mount.isMain]), [['BFF', 'main checkout', true], ['UI', 'my-worktree', false]]);
});

test('groupServices merges services deployed at the same commit, most behind first', () => {
  const markers = [{ service: 'ui', sha: 'aaaaaaaaaaaa' }, { service: 'bff', sha: 'aaaaaaaaaaaa' }, { service: 'agent', sha: 'bbbbbbbbbbbb' }];
  assert.deepEqual(groupServices(markers, new Map([['aaaaaaaaaaaa', 0], ['bbbbbbbbbbbb', 12]])), [
    { sha: 'bbbbbbbbb', services: ['agent'], commitsSince: 12 },
    { sha: 'aaaaaaaaa', services: ['bff', 'ui'], commitsSince: 0 },
  ]);
});

test('imageBuilds picks the newest Build images runs out of the run list', () => {
  const run = (id, name, created) => ({ id, name, created_at: created, status: 'completed', conclusion: 'success', head_sha: 'abcdef1234567', display_title: `t${id}`, html_url: `https://github.com/o/r/actions/runs/${id}` });
  const builds = imageBuilds([run(1, 'CI', '2026-10-01T10:00:00Z'), run(2, 'Build images', '2026-10-01T09:00:00Z'), run(3, 'Build images', '2026-10-01T11:00:00Z')]);
  assert.deepEqual(builds.map((build) => [build.id, build.sha, build.conclusion]), [[3, 'abcdef123', 'success'], [2, 'abcdef123', 'success']]);
});

function fakeFs(files, dirs) {
  return {
    readFileSync: (file) => { if (file in files) return files[file]; throw new Error('ENOENT'); },
    readdirSync: (dir) => { if (dir in dirs) return dirs[dir]; throw new Error('ENOENT'); },
    existsSync: (target) => target in files || target in dirs,
  };
}

function fakeGit(responses) {
  return (command, args, _options, callback) => {
    const key = `${command} ${args.join(' ')}`;
    const hit = Object.keys(responses).find((prefix) => key.startsWith(prefix));
    callback(hit ? null : new Error('unexpected'), hit ? responses[hit] : '');
  };
}

test('readDeployState reads markers, the lock and history without writing anything', async () => {
  const fs = fakeFs({
    '/repo/.git/deploy-live/services/ui.sha': 'aaaaaaaaaaaa\n',
    '/repo/.git/deploy-live/services/bff.sha': 'bbbbbbbbbbbb\n',
    '/repo/.git/deploy-live/services/broken.sha': 'not a sha\n',
    '/repo/.git/deploy-live.lock/pid': '4242\n',
    '/repo/.git/deploy-live.restarts': '2026-10-01T12:02:56Z  deploy 93919932eecb  restarted: ui  ui@x\n',
  }, {
    '/repo/.git/deploy-live/services': ['ui.sha', 'bff.sha', 'broken.sha', 'README'],
    '/repo/.git/deploy-live.lock': ['pid'],
  });
  const execFile = fakeGit({
    'git rev-parse --path-format=absolute --git-common-dir': '/repo/.git\n',
    'git rev-parse HEAD': 'cccccccccccc\n',
    'git rev-list --count aaaaaaaaaaaa..cccccccccccc': '0\n',
    'git rev-list --count bbbbbbbbbbbb..cccccccccccc': '7\n',
    'bash /repo/scripts/serve-worktree.sh': 'BFF  main checkout   /repo/demo_api_server\n',
  });

  const state = await readDeployState({ repoRoot: '/repo', fs, execFile, isAlive: (pid) => pid === 4242 });

  assert.equal(state.available, true);
  assert.equal(state.head, 'ccccccccc');
  assert.deepEqual(state.lock, { running: true, pid: 4242, stale: false });
  assert.equal(state.serviceCount, 2, 'a marker that is not a commit id is ignored');
  assert.deepEqual(state.groups, [
    { sha: 'bbbbbbbbb', services: ['bff'], commitsSince: 7 },
    { sha: 'aaaaaaaaa', services: ['ui'], commitsSince: 0 },
  ]);
  assert.equal(state.recent[0].sha, '93919932e');
  assert.equal(state.served[0].isMain, true);

  const stale = await readDeployState({ repoRoot: '/repo', fs, execFile, isAlive: () => false });
  assert.deepEqual(stale.lock, { running: false, pid: 4242, stale: true });
});

test('readDeployState reports unavailable outside a git checkout', async () => {
  const state = await readDeployState({ repoRoot: '/nowhere', fs: fakeFs({}, {}), execFile: fakeGit({}) });
  assert.deepEqual(state, { available: false });
});
