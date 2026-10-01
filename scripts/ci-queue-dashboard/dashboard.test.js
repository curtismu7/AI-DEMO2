'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Small DOM adapter for the standalone script's public DOM operations. The
// production renderer and event handlers run unchanged; only browser IO is fake.
async function dashboard(runs, nowMs = Date.now()) {
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
  const window = { CiQueueDashboardModel: require('./dashboard-model'), setInterval() {}, confirm() { assert.fail('Details must not ask for action confirmation'); } };
  const context = vm.createContext({ document, window, URL, Intl, Date: DashboardDate, fetch: async (url, options) => {
    requests.push({ url, options });
    assert.ok(['/api/snapshot', '/api/control-state'].includes(url), `Unexpected request: ${url}`);
    return { ok: true, json: async () => url === '/api/snapshot' ? { runs, repository: 'owner/repo', summary: {}, updatedAt: '2026-09-28T10:06:00Z' } : { workflows: [], runners: [] } };
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
