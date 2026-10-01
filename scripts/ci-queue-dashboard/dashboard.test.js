'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Small DOM adapter for the standalone script's public DOM operations. The
// production renderer and event handlers run unchanged; only browser IO is fake.
async function dashboard(runs, nowMs = Date.now(), { insights = null, controls = { workflows: [], runners: [] }, confirm } = {}) {
  const ids = new Map();
  const listeners = {};
  const requests = [];
  let focused;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.text = ''; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ''; this.children = children; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, handler) { this[name] = handler; }
    focus() { focused = this; }
    closest(selector) {
      const attribute = selector.match(/^button\[data-(.+)\]$/)?.[1];
      const key = attribute?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.tagName === 'button' && this.dataset[key] !== undefined ? this : null;
    }
  }
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1]);
    element.hidden = /\bhidden\b/.test(match[0]);
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attr[1], attr[2]);
    ids.set(match[2], element);
  }
  const document = {
    visibilityState: 'visible',
    getElementById: (id) => ids.get(id) || null,
    createElement: (tag) => new Element(tag),
    addEventListener: (name, handler) => { listeners[name] = handler; },
  };
  class DashboardDate extends Date {
    static now() { return nowMs; }
  }
  const window = { CiQueueDashboardModel: require('./dashboard-model'), setInterval() {}, confirm: confirm || (() => { assert.fail('Details must not ask for action confirmation'); }) };
  const context = vm.createContext({ document, window, URL, Intl, Date: DashboardDate, fetch: async (url, options) => {
    requests.push({ url, options });
    assert.ok(['/api/snapshot', '/api/control-state', '/api/insights', '/api/actions'].includes(url), `Unexpected request: ${url}`);
    if (url === '/api/insights') return { ok: insights !== null, json: async () => insights || { error: {} } };
    if (url === '/api/actions') return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, json: async () => url === '/api/snapshot' ? { runs, repository: 'owner/repo', summary: {}, updatedAt: '2026-09-28T10:06:00Z' } : controls };
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const all = () => [...ids.values()].flatMap(descendants);
  return { ids, requests, all, descendants, focused: () => focused, click: (target) => listeners.click({ target }), key: (key) => listeners.keydown?.({ key }) };
}

test('run details opens an accessible read-only panel with safe job/step progress and split timing, then closes', async () => {
  const ui = await dashboard([{ id: 7, title: '<script>Run</script>', workflow: 'CI', status: 'in_progress', createdAt: '2026-09-28T10:00:00Z', startedAt: '2026-09-28T10:02:00Z', jobs: [
    { name: 'Build', status: 'in_progress', startedAt: '2026-09-28T10:03:00Z', steps: [
      { name: 'Checkout', status: 'completed', conclusion: 'success', startedAt: '2026-09-28T10:03:00Z', completedAt: '2026-09-28T10:03:30Z' },
      { name: '<img src=x onerror=alert(1)>', status: 'in_progress', startedAt: '2026-09-28T10:03:30Z' },
    ] },
  ] }]);
  const open = ui.all().find((item) => item.textContent === 'Run details');
  assert.ok(open, 'Each run offers Run details');
  const requestCount = ui.requests.length;
  ui.click(open);
  const panel = ui.ids.get('run-detail-panel');
  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute('aria-labelledby'), 'run-detail-title');
  assert.equal(ui.ids.get('queue-view').hidden, true);
  assert.equal(ui.focused(), ui.ids.get('run-detail-title'));
  assert.match(panel.textContent + ui.ids.get('run-detail-content').textContent, /Queue wait: 2m 0s/);
  const content = ui.ids.get('run-detail-content').textContent;
  for (const expected of ['Execution duration:', 'Build', 'Checkout', 'Passed', '30s', 'Current step', '<img src=x onerror=alert(1)>']) assert.ok(content.includes(expected), expected);
  assert.equal(ui.all().some((item) => ['img', 'script'].includes(item.tagName)), false);
  assert.equal(ui.descendants(ui.ids.get('run-detail-content')).some((item) => item.dataset.actionType), false);
  assert.equal(ui.descendants(ui.ids.get('run-detail-content')).find((item) => item.getAttribute('aria-current') === 'step')?.textContent.includes('Current step'), true);
  assert.equal(open.getAttribute('aria-expanded'), 'true');
  ui.click(ui.ids.get('run-detail-close'));
  assert.equal(panel.hidden, true);
  assert.equal(ui.ids.get('queue-view').hidden, false);
  assert.equal(ui.focused(), open);
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.requests.length, requestCount, 'Opening/closing performs no requests');
  ui.click(open);
  ui.key('Escape');
  assert.equal(panel.hidden, true);
});

test('active run cards keep the run timer and show the current step timer separately', async () => {
  const nowMs = Date.parse('2026-09-28T10:10:05Z');
  const ui = await dashboard([{
    id: 7,
    title: 'UI tests',
    workflow: 'CI',
    status: 'in_progress',
    createdAt: '2026-09-28T10:00:00Z',
    startedAt: '2026-09-28T10:02:00Z',
    jobs: [{
      name: 'UI tests (Vitest) + build',
      status: 'in_progress',
      startedAt: '2026-09-28T10:03:00Z',
      steps: [{ name: 'Vitest unit suite', status: 'in_progress', startedAt: '2026-09-28T10:09:00Z' }],
    }],
  }], nowMs);
  const card = ui.ids.get('active-runs').children[0];

  assert.ok(card.textContent.includes('Running 8m 5s'), 'retains elapsed workflow runtime');
  for (const label of ['Current step', 'UI tests (Vitest) + build', 'Vitest unit suite', 'Elapsed: 1m 5s']) {
    assert.ok(card.textContent.includes(label), label);
  }
});

test('details labels missing jobs, steps and timestamps unavailable without a guessed clock', async () => {
  const ui = await dashboard([
    { id: 1, title: 'No jobs', status: 'completed', updatedAt: '2026-09-28T10:06:00Z', jobs: [] },
    { id: 2, title: 'No steps', status: 'completed', jobs: [{ name: 'Build', status: 'completed', startedAt: '2026-09-28T10:02:00Z' }] },
  ]);
  const buttons = ui.all().filter((item) => item.textContent === 'Run details');
  assert.equal(buttons.length, 2);
  ui.click(buttons[0]);
  assert.match(ui.ids.get('run-detail-content').textContent, /Queue wait: Time unavailable/);
  assert.match(ui.ids.get('run-detail-content').textContent, /Execution duration: Time unavailable/);
  assert.match(ui.ids.get('run-detail-content').textContent, /Job details are unavailable/);
  ui.click(ui.ids.get('run-detail-close'));
  ui.click(buttons[1]);
  assert.match(ui.ids.get('run-detail-content').textContent, /Elapsed: Time unavailable/);
  assert.match(ui.ids.get('run-detail-content').textContent, /Step details are unavailable/);
});

test('insights render the main-red banner, stale and duplicate flags, host load, wait trend and workflow log', async () => {
  const nowMs = Date.parse('2026-10-01T12:00:00Z');
  const runs = [
    { id: 21, title: 'PR run', workflow: 'CI', status: 'queued', createdAt: '2026-10-01T11:50:00Z', jobs: [] },
    { id: 22, title: 'Manual run', workflow: 'CI', status: 'queued', createdAt: '2026-10-01T11:55:00Z', jobs: [] },
  ];
  const insights = {
    staleRuns: [{ id: 21, pr: 457, state: 'merged' }, { id: 999, pr: 400, state: 'closed' }],
    duplicateRuns: [{ id: 22, duplicateOf: 21 }],
    main: { state: 'red', branch: 'main', workflow: 'CI', failedJobs: ['API server tests (Jest)'],
      latest: { id: 5, url: 'https://github.com/o/r/actions/runs/5' }, firstBad: { title: 'Merge pull request #456 from a/b', pr: 456, sha: 'abc123def' } },
    turnaroundTrend: [{ day: '2026-09-30', medianMs: 60000, runs: 3 }, { day: '2026-10-01', medianMs: 1200000, runs: 8 }],
    host: { load1: 48.5, cores: 16, top: [{ name: 'OrbStack', cpuPercent: 122.2, memMb: 14053 }] },
  };
  const controls = { workflows: [], runners: [], workflowLog: [{ at: '2026-10-01T11:26:00Z', workflow: 'CI', change: 'resumed', source: 'outside' }] };
  const ui = await dashboard(runs, nowMs, { insights, controls });

  const banner = ui.ids.get('main-health');
  assert.equal(banner.hidden, false);
  for (const expected of ['main is red: CI', 'API server tests (Jest)', 'PR #456', 'Open failing run']) assert.ok(banner.textContent.includes(expected), expected);

  const queued = ui.ids.get('queued-runs').textContent;
  assert.ok(queued.includes('Stale: PR #457 is merged'));
  assert.ok(queued.includes('Duplicate of run 21 (same commit)'));

  assert.equal(ui.ids.get('stale-runs').hidden, false);
  assert.ok(ui.ids.get('stale-summary').textContent.startsWith('1 queued or running run is'), 'a stale id that is no longer in the queue is not counted');
  assert.equal(ui.ids.get('stale-cancel').dataset.runIds, '21');

  assert.equal(ui.ids.get('host-load').hidden, false);
  assert.equal(ui.ids.get('host-load').dataset.pressure, 'high');
  assert.ok(ui.ids.get('host-load-figure').textContent.includes('Load 48.5 on 16 cores'));
  assert.ok(ui.ids.get('host-load-content').textContent.includes('OrbStack: 122% CPU, 14053 MB'));

  assert.equal(ui.ids.get('wait-trend').hidden, false);
  assert.ok(ui.ids.get('wait-trend-content').textContent.includes('20m 0s median, 8 runs'));
  assert.ok(ui.ids.get('workflow-log').textContent.includes('CI resumed outside this dashboard'));
});

test('stop stale runs asks once and cancels only the flagged runs', async () => {
  let prompts = 0;
  const runs = [
    { id: 21, title: 'Stale', workflow: 'CI', status: 'queued', createdAt: '2026-10-01T11:50:00Z', jobs: [] },
    { id: 23, title: 'Live', workflow: 'CI', status: 'queued', createdAt: '2026-10-01T11:51:00Z', jobs: [] },
  ];
  const ui = await dashboard(runs, Date.parse('2026-10-01T12:00:00Z'), {
    insights: { staleRuns: [{ id: 21, pr: 457, state: 'merged' }] },
    confirm: () => { prompts += 1; return true; },
  });
  ui.click(ui.ids.get('stale-cancel'));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const actions = ui.requests.filter((request) => request.url === '/api/actions').map((request) => JSON.parse(request.options.body));
  assert.equal(prompts, 1);
  assert.deepEqual(actions, [{ type: 'run', action: 'cancel', id: 21 }]);
});

test('the queue still renders when insights are unavailable', async () => {
  const ui = await dashboard([{ id: 7, title: 'Run', workflow: 'CI', status: 'queued', createdAt: '2026-10-01T11:50:00Z', jobs: [] }]);
  assert.ok(ui.ids.get('queued-runs').textContent.includes('Run'));
  for (const id of ['main-health', 'stale-runs', 'host-load', 'wait-trend']) assert.equal(ui.ids.get(id).hidden, true, id);
});

test('a running job names its slowest step against the typical duration from recent runs', async () => {
  const nowMs = Date.parse('2026-10-01T12:10:00Z');
  const step = (name, start, end) => ({ name, status: end ? 'completed' : 'in_progress', conclusion: end ? 'success' : null, startedAt: start, completedAt: end || null });
  const runs = [
    { id: 1, workflow: 'CI', title: 'Earlier', status: 'completed', conclusion: 'success', createdAt: '2026-10-01T10:00:00Z', jobs: [
      { name: 'Gates', status: 'completed', conclusion: 'success', steps: [step('Install deps', '2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z')] }] },
    { id: 2, workflow: 'CI', title: 'Now', status: 'in_progress', createdAt: '2026-10-01T12:00:00Z', startedAt: '2026-10-01T12:00:00Z', jobs: [
      { name: 'Gates', status: 'in_progress', startedAt: '2026-10-01T12:00:00Z', steps: [
        step('Checkout', '2026-10-01T12:00:00Z', '2026-10-01T12:00:05Z'),
        step('Install deps', '2026-10-01T12:00:05Z', null)] }] },
  ];
  const ui = await dashboard(runs, nowMs);
  const card = ui.ids.get('active-runs').children[0];
  assert.ok(card.textContent.includes('Slowest step in Gates: Install deps, 9m 55s (typically 30s)'), card.textContent);
  const slow = ui.descendants(card).find((item) => String(item.className || '').includes('run-slowest-step--slow'));
  assert.ok(slow, 'a step far over its typical time is marked slow');
});

test('the deploy queue shows what is not yet deployed, a running deploy, a served worktree and image builds', async () => {
  const deploy = {
    available: true, head: 'ccccccccc', serviceCount: 6,
    lock: { running: true, pid: 4242, stale: false },
    groups: [
      { sha: 'bbbbbbbbb', services: ['a', 'b', 'c', 'd', 'e'], commitsSince: 312 },
      { sha: 'ccccccccc', services: ['ui'], commitsSince: 0 },
    ],
    served: [{ mount: 'BFF', checkout: 'main checkout', isMain: true }, { mount: 'UI', checkout: 'my-worktree', isMain: false }],
    recent: [{ at: '2026-10-01T12:02:56Z', sha: '93919932e', services: ['ui', 'demo-api-server'] }],
  };
  const imageBuilds = [{ id: 9, title: 'Merge pull request #466', sha: 'abcdef123', status: 'queued', conclusion: null, createdAt: '2026-10-01T12:12:51Z', url: 'https://github.com/o/r/actions/runs/9' }];
  const ui = await dashboard([], Date.parse('2026-10-01T12:30:00Z'), { insights: { deploy, imageBuilds } });

  const panel = ui.ids.get('deploy-panel');
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.state, 'running');
  assert.equal(ui.ids.get('deploy-state').textContent, 'Deploy running (process 4242)');
  const local = ui.ids.get('deploy-local').textContent;
  for (const expected of ['a, b, c, d and 1 more', 'deployed at bbbbbbbbb, 312 commits on disk since', 'at the current commit (ccccccccc)', 'Serving a worktree, not main: UI from my-worktree', 'not all of them touch it']) {
    assert.ok(local.includes(expected), expected);
  }
  assert.ok(ui.ids.get('deploy-recent').textContent.includes('93919932e restarted ui, demo-api-server'));
  const builds = ui.ids.get('deploy-builds').textContent;
  for (const expected of ['Queued', 'Merge pull request #466', 'abcdef123', 'Open run']) assert.ok(builds.includes(expected), expected);
  assert.equal(ui.descendants(panel).some((item) => item.dataset.actionType), false, 'the deploy queue is read-only');
});

test('the deploy queue reads up to date when nothing is pending and hides when there is no data', async () => {
  const current = await dashboard([], Date.now(), { insights: { deploy: { available: true, lock: { running: false }, groups: [{ sha: 'c', services: ['ui'], commitsSince: 0 }], served: [], recent: [] }, imageBuilds: [] } });
  assert.equal(current.ids.get('deploy-state').textContent, 'Up to date');
  assert.equal(current.ids.get('deploy-panel').dataset.state, 'current');

  const none = await dashboard([], Date.now(), { insights: { deploy: { available: false }, imageBuilds: [] } });
  assert.equal(none.ids.get('deploy-panel').hidden, true);
});
