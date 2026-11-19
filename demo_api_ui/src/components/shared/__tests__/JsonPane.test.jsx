import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JsonPane, { JSON_VIEW_KEY, JsonViewOnly, MAX_FORM_DEPTH, MAX_PANE_CHARS, deepParse, isBenignAlertValue, kindOf, parseJsonText, setJsonView, splitWire } from '../JsonPane';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlMTIz';
const TOKEN = { s: 'text', sub: 'user-1', aud: 'gateway', scope: 'read write', n: 42, ok: true, bad: false, none: null, site: 'https://example.com/a', id: '123e4567-e89b-12d3-a456-426614174000', exp: 1893456000 };

beforeEach(() => {
  setJsonView('form'); // also drops an in-memory choice left by the "storage throws" case
  window.localStorage.clear(); // no saved choice: the default applies
});
afterEach(() => {
  vi.restoreAllMocks();
});

const pane = (ui) => render(ui).container;
const tok = (c, kind) => [...c.querySelectorAll(`.jp-tok--${kind}`)].map((n) => n.textContent);
const asJson = async () => userEvent.click(screen.getAllByRole('button', { name: 'JSON' })[0]);

describe('JsonPane: Form | JSON toggle', () => {
  it('opens on Form by default and labels the switch exactly Form and JSON', () => {
    const c = pane(<JsonPane value={TOKEN} label="Claims" />);
    const [form, json] = screen.getAllByRole('button');
    expect(form).toHaveTextContent(/^Form$/);
    expect(json).toHaveTextContent(/^JSON$/);
    expect(form).toHaveAttribute('aria-pressed', 'true');
    expect(json).toHaveAttribute('aria-pressed', 'false');
    expect(c.querySelector('.jp-form')).toBeTruthy();
    expect(c.querySelector('.jp-raw')).toBeNull();
  });

  it('switches to the exact JSON text and stores the choice', async () => {
    const c = pane(<JsonPane value={{ a: 1 }} />);
    await asJson();
    expect(c.querySelector('.jp-raw').textContent).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(window.localStorage.getItem(JSON_VIEW_KEY)).toBe('json');
  });

  it('is one choice for the whole page: every pane follows', async () => {
    const c = pane(
      <>
        <JsonPane value={{ a: 1 }} label="one" />
        <JsonPane value={{ b: 2 }} label="two" />
      </>,
    );
    expect(c.querySelectorAll('.jp-form')).toHaveLength(2);
    await asJson();
    expect(c.querySelectorAll('.jp-raw')).toHaveLength(2);
    expect(c.querySelectorAll('.jp-form')).toHaveLength(0);
  });

  it("a visitor's saved choice wins over the pane's default and over a defaultView prop", () => {
    window.localStorage.setItem(JSON_VIEW_KEY, 'json');
    const c = pane(<JsonPane value={{ a: 1 }} defaultView="form" />);
    expect(c.querySelector('.jp-raw')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaultView applies only while nothing is saved', () => {
    const c = pane(<JsonPane value={{ a: 1 }} defaultView="json" />);
    expect(c.querySelector('.jp-raw')).toBeTruthy();
  });

  it('still works when localStorage throws (the choice then lives for the session)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const c = pane(<JsonPane value={{ a: 1 }} />);
    expect(c.querySelector('.jp-form')).toBeTruthy();
    await asJson();
    expect(c.querySelector('.jp-raw')).toBeTruthy();
  });

  it('toggle={false} hides the switch; JsonViewOnly forces the JSON view without a second switch', () => {
    const sw = { name: /^(form|json)$/i }; // the switch only: the Form view's per-field Copy buttons are not part of it
    const a = pane(<JsonPane value={{ a: 1 }} toggle={false} />);
    expect(within(a).queryByRole('button', sw)).toBeNull();
    const b = pane(
      <JsonViewOnly>
        <JsonPane value={{ a: 1 }} />
      </JsonViewOnly>,
    );
    expect(b.querySelector('.jp-raw')).toBeTruthy();
    expect(within(b).queryByRole('button')).toBeNull();
  });

  it('shows a plain string as text with no switch, and a missing value as an empty pane', () => {
    const a = pane(<JsonPane value="just text" />);
    expect(within(a).queryByRole('button')).toBeNull();
    expect(a.querySelector('.jp-raw').textContent).toBe('just text');
    const b = pane(<JsonPane value={undefined} />);
    expect(b.textContent).not.toContain('undefined');
  });
});

describe('JsonPane: colour by role (JSON view)', () => {
  it('gives each part its role class', async () => {
    const c = pane(<JsonPane value={TOKEN} />);
    await asJson();
    expect(tok(c, 'string')).toEqual(['"text"']);
    expect(tok(c, 'number')).toEqual(['42']);
    expect(tok(c, 'bool')).toEqual(['true', 'false']);
    expect(tok(c, 'null')).toEqual(['null']);
    expect(tok(c, 'url')).toEqual(['"https://example.com/a"']);
    expect(tok(c, 'id')).toEqual(['"123e4567-e89b-12d3-a456-426614174000"']);
    expect(tok(c, 'time')).toEqual(['1893456000']);
    expect(tok(c, 'key')).toContain('"n"');
    expect(tok(c, 'punct').length).toBeGreaterThan(5);
  });

  it('shows a token in three segments, each its own colour class', async () => {
    const c = pane(<JsonPane value={{ access_token: JWT }} />);
    await asJson();
    expect(tok(c, 'jwt1')).toEqual(['eyJhbGciOiJSUzI1NiJ9']);
    expect(tok(c, 'jwt2')).toEqual(['eyJzdWIiOiJ1c2VyLTEifQ']);
    expect(tok(c, 'jwt3')).toEqual(['c2lnbmF0dXJlMTIz']);
  });

  it('a Bearer prefix stays plain and a bare token string is coloured too', () => {
    const c = pane(<JsonPane value={`Bearer ${JWT}`} />);
    expect(tok(c, 'plain')[0]).toBe('Bearer ');
    expect(tok(c, 'jwt1')).toHaveLength(1);
    const d = pane(<JsonPane value={JWT} />);
    expect(tok(d, 'jwt3')).toEqual(['c2lnbmF0dXJlMTIz']);
  });

  it('the Form view colours a token and chips for scopes, true and false', () => {
    const c = pane(<JsonPane value={{ access_token: JWT, scope: 'read write', ok: true, bad: false }} />);
    expect(c.querySelectorAll('.jp-jwt .jp-tok--jwt1, .jp-jwt .jp-tok--jwt2, .jp-jwt .jp-tok--jwt3')).toHaveLength(3);
    expect([...c.querySelectorAll('.jp-chips .jp-chip')].map((n) => n.textContent)).toEqual(['read', 'write']);
    expect([...c.querySelectorAll('.jp-chip[data-on]')].map((n) => `${n.textContent}:${n.dataset.on}`)).toEqual(['true:true', 'false:false']);
  });

  it('kindOf names every kind', () => {
    expect([null, true, 1, 'x', 'https://a.b', '123e4567-e89b-12d3-a456-426614174000', '2026-11-14T10:00:00Z', JWT].map((v) => kindOf(v))).toEqual(['null', 'bool', 'number', 'string', 'url', 'id', 'time', 'token']);
    expect(kindOf(1893456000, 'exp')).toBe('time');
  });
});

describe('JsonPane: important and error keys', () => {
  it('stands out the default hot keys in both views', async () => {
    const c = pane(<JsonPane value={{ sub: 'u', aud: 'a', other: 'x' }} />);
    expect([...c.querySelectorAll('.jp-row[data-hot="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['sub', 'aud']);
    await asJson();
    expect(tok(c, 'hot')).toEqual(expect.arrayContaining(['"sub"', '"aud"', '"u"', '"a"']));
    expect(tok(c, 'hot')).not.toContain('"other"');
  });

  it('the hot prop adds keys', async () => {
    const c = pane(<JsonPane value={{ tool: 'transfer', risk: 'high' }} hot={['tool']} />);
    expect([...c.querySelectorAll('.jp-row[data-hot="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['tool']);
    await asJson();
    expect(tok(c, 'hot')).toContain('"tool"');
    expect(tok(c, 'key')).toContain('"risk"');
  });

  it('shows error and decision keys in the alert colour, and the alert prop adds keys', async () => {
    const c = pane(<JsonPane value={{ error: 'invalid_grant', decision: 'DENY', status: 400 }} alert={['status']} />);
    expect([...c.querySelectorAll('.jp-row[data-alert="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['error', 'decision', 'status']);
    await asJson();
    expect(tok(c, 'alert')).toEqual(expect.arrayContaining(['"error"', '"invalid_grant"', '"decision"', '"DENY"', '"status"']));
  });
});

describe('JsonPane: alert emphasis follows the value', () => {
  const BENIGN = [['decision', 'allow'], ['decision', 'ALLOWED'], ['outcome', ' success '], ['verdict', 'pass'], ['reason', 'ok'], ['note', 'none'], ['decision', 'permit'], ['decision', 'approved'], ['decision', 'granted'], ['outcome', 'succeeded'], ['verdict', 'valid'], ['reason', 'active'], ['note', 'true'], ['error', null], ['error', false], ['error', 0], ['error_description', ''], ['decision', undefined], ['detail_code', ''],
    // booleans and 2xx numbers on a non-error key
    ['decision', true], ['verdict', true], ['outcome', true], ['reason', true], ['outcome', 200], ['verdict', 201], ['decision', 204],
    // "none" clears the error-type keys and note / reason
    ['error', 'none'], ['error_description', ' None '], ['detail_code', 'none'], ['reason', 'none'],
    // empty text, array or object on any alert key
    ['error', []], ['error', {}], ['reason', '   '], ['note', '\t\n'], ['decision', []], ['error_description', '  ']];
  const FAILING = [['decision', 'deny'], ['decision', 'denied'], ['decision', 'blocked'], ['error', 'invalid_grant'], ['error', true], ['error', 'access denied by policy'], ['note', 'scope narrowed from transfer:read'], ['reason', 'unknown_word'], ['outcome', 'partial'], ['verdict', false], ['reason', 0], ['error', { code: 1 }], ['decision', ['allow']], ['error', 500],
    // prefix, suffix and near-miss values must not match the word list
    ['decision', 'allow_with_conditions'], ['decision', 'not allowed'], ['outcome', 'unsuccessful'], ['outcome', 'passed with warnings'], ['outcome', 'passed_with_warnings'], ['verdict', 'inactive'], ['verdict', 'invalid'], ['decision', 'none of the above'], ['reason', 'ok but'], ['decision', '  deny  '],
    // the word list is keyed: success words do not clear an error-type key, "none" does not clear a decision
    ['error', 'true'], ['error', 'ok'], ['error', 'success'], ['error', 'valid'], ['error_description', 'allow'], ['detail_code', true], ['decision', 'none'], ['outcome', 'none'], ['verdict', 'none'],
    // non-2xx numbers and a non-empty container
    ['outcome', 400], ['verdict', 302], ['outcome', 1], ['decision', 199], ['decision', 300], ['error', [1]], ['reason', { a: 1 }]];

  it('the helper: a failure-or-unknown value is not benign, a clearly good or empty one is', () => {
    for (const [k, v] of BENIGN) expect(isBenignAlertValue(k, v), `${k}=${JSON.stringify(v)}`).toBe(true);
    for (const [k, v] of FAILING) expect(isBenignAlertValue(k, v), `${k}=${JSON.stringify(v)}`).toBe(false);
  });

  it.each(BENIGN.filter(([, v]) => v !== undefined))('Form: %s = %j is a normal row', (key, v) => {
    const c = pane(<JsonPane value={{ [key]: v }} />);
    expect(c.querySelector('.jp-row')).toBeTruthy();
    expect(c.querySelector('.jp-row[data-alert="true"]')).toBeNull();
  });

  it.each(FAILING)('Form: %s = %j keeps the alert row', (key, v) => {
    const c = pane(<JsonPane value={{ [key]: v }} />);
    expect(c.querySelector('.jp-row[data-alert="true"] > .jp-k').textContent).toBe(key);
  });

  it.each(BENIGN.filter(([, v]) => v !== undefined))('JSON: %s = %j paints no alert token', async (key, v) => {
    const c = pane(<JsonPane value={{ [key]: v }} />);
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'alert')).toEqual([]);
    expect(tok(c, 'key')).toContain(JSON.stringify(key));
  });

  it.each(FAILING)('JSON: %s = %j paints the key in the alert colour', async (key, v) => {
    const c = pane(<JsonPane value={{ [key]: v }} />);
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'alert')).toContain(JSON.stringify(key));
    if (typeof v === 'string') expect(tok(c, 'alert')).toContain(JSON.stringify(v));
  });

  it('one pane mixes both: only the failing key is alert, in both views', async () => {
    const c = pane(<JsonPane value={{ decision: 'allow', error: null, outcome: 'success', reason: 'policy_denied' }} />);
    expect([...c.querySelectorAll('.jp-row[data-alert="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['reason']);
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'alert')).toEqual(['"reason"', '"policy_denied"']);
  });

  it('a benign alert key that is also hot keeps its hot style, in both views', async () => {
    const c = pane(<JsonPane value={{ decision: 'allow' }} hot={['decision']} />);
    expect(c.querySelector('.jp-row[data-hot="true"]')).toBeTruthy();
    expect(c.querySelector('.jp-row[data-alert="true"]')).toBeNull();
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'hot')).toEqual(expect.arrayContaining(['"decision"', '"allow"']));
    expect(tok(c, 'alert')).toEqual([]);
  });

  it('caller alert keys follow the same rules: true and 2xx are normal rows, 4xx and false stay alert', () => {
    const c = pane(<JsonPane value={{ status: 200, result: true, outcome: false, code: 404 }} alert={['status', 'result', 'code']} />);
    expect([...c.querySelectorAll('.jp-row[data-alert="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['outcome', 'code']);
  });

  it('the alert prop is value-aware too', () => {
    const c = pane(<JsonPane value={{ status: 'ok', result: 'blocked' }} alert={['status', 'result']} />);
    expect([...c.querySelectorAll('.jp-row[data-alert="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['result']);
  });
});

describe('JsonPane: alert={false} turns alert emphasis off', () => {
  const NEUTRAL = { error: 'boom', decision: 'deny', reason: 'free text', note: 'x' };
  const alertKeys = (c) => [...c.querySelectorAll('.jp-row[data-alert="true"] > .jp-k')].map((n) => n.textContent);
  const headWire = 'POST /x HTTP/1.1\nHost: a\n\n{"error":"boom","decision":"deny","reason":"free text","note":"x"}';

  it('control: the same value without the prop still alerts, in both views', async () => {
    const c = pane(<JsonPane value={NEUTRAL} />);
    expect(alertKeys(c)).toEqual(['error', 'decision', 'reason', 'note']);
    await asJson();
    expect(tok(c, 'alert')).toEqual(expect.arrayContaining(['"error"', '"boom"', '"decision"', '"deny"', '"reason"', '"free text"', '"note"', '"x"']));
  });

  it('control: alert undefined and alert={[]} keep today\'s behaviour', () => {
    expect(alertKeys(pane(<JsonPane value={NEUTRAL} alert={undefined} />))).toEqual(['error', 'decision', 'reason', 'note']);
    expect(alertKeys(pane(<JsonPane value={NEUTRAL} alert={[]} />))).toEqual(['error', 'decision', 'reason', 'note']);
  });

  it('Form view: no row carries data-alert, and the rows still render', () => {
    const c = pane(<JsonPane value={NEUTRAL} alert={false} />);
    expect(c.querySelector('[data-alert]')).toBeNull();
    expect([...c.querySelectorAll('.jp-row > .jp-k')].map((n) => n.textContent)).toEqual(['error', 'decision', 'reason', 'note']);
    expect(c.textContent).toContain('free text');
  });

  it('JSON view: no jp-tok--alert token, the keys read as normal keys, the text is unchanged', async () => {
    const c = pane(<JsonPane value={NEUTRAL} alert={false} />);
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(c.querySelector('.jp-tok--alert')).toBeNull();
    expect(tok(c, 'key')).toEqual(['"error"', '"decision"', '"reason"', '"note"']);
    expect(c.querySelector('.jp-raw').textContent).toBe(JSON.stringify(NEUTRAL, null, 2));
  });

  it('a key that is also in the hot list keeps its hot style, in both views', async () => {
    const c = pane(<JsonPane value={NEUTRAL} alert={false} hot={['decision']} />);
    expect([...c.querySelectorAll('.jp-row[data-hot="true"] > .jp-k')].map((n) => n.textContent)).toEqual(['decision']);
    expect(c.querySelector('[data-alert]')).toBeNull();
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'hot')).toEqual(expect.arrayContaining(['"decision"', '"deny"']));
    expect(tok(c, 'alert')).toEqual([]);
  });

  it('an array alert still adds keys (and the built-in keys still alert)', async () => {
    const c = pane(<JsonPane value={{ status: 'bad', error: 'boom', other: 'x' }} alert={['status']} />);
    expect(alertKeys(c)).toEqual(['status', 'error']);
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(tok(c, 'alert')).toEqual(expect.arrayContaining(['"status"', '"error"']));
    expect(tok(c, 'alert')).not.toContain('"other"');
  });

  it('alert={false} also switches off a caller key that an array would have added', () => {
    const on = pane(<JsonPane value={{ status: 'bad' }} alert={['status']} />);
    expect(alertKeys(on)).toEqual(['status']);
    const off = pane(<JsonPane value={{ status: 'bad' }} alert={false} />);
    expect(off.querySelector('[data-alert]')).toBeNull();
  });

  it('nested objects and arrays under an alert key are not alert', async () => {
    const value = { error: { code: 1, detail: { reason: 'inner free text' } }, decision: ['deny', 'x'], list: [{ note: 'n', error: 'e' }] };
    const c = pane(<JsonPane value={value} alert={false} />);
    expect(c.querySelector('[data-alert]')).toBeNull();
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-raw')).not.toBeNull());
    expect(c.querySelector('.jp-tok--alert')).toBeNull();
    // control: without the prop the same payload alerts, at the top level and nested
    setJsonView('form');
    const d = pane(<JsonPane value={value} />);
    expect(alertKeys(d)).toEqual(expect.arrayContaining(['error', 'decision', 'reason']));
  });

  it('the wire-split path passes it to the body pane (head stays text, body has no alert)', async () => {
    const c = pane(<JsonPane value={headWire} label="Request" alert={false} />);
    expect(c.querySelector('.jp-raw--head').textContent).toContain('POST /x HTTP/1.1');
    expect(c.querySelector('.jp-form')).toBeTruthy();
    expect(c.querySelector('[data-alert]')).toBeNull();
    await asJson();
    await waitFor(() => expect(c.querySelector('.jp-box .jp-raw')).not.toBeNull());
    expect(c.querySelector('.jp-tok--alert')).toBeNull();
    expect(tok(c, 'key')).toEqual(['"error"', '"decision"', '"reason"', '"note"']);
    // control: the same transcript without the prop alerts in the body pane
    setJsonView('form');
    const d = pane(<JsonPane value={headWire} label="Request" />);
    expect(alertKeys(d)).toEqual(['error', 'decision', 'reason', 'note']);
  });
});

describe('JsonPane: JSON in strings and HTTP transcripts', () => {
  it('a string holding JSON gets the panes; the JSON view shows it EXACTLY as given', async () => {
    const raw = '{"b":2,   "a":1}';
    const c = pane(<JsonPane value={raw} />);
    expect(c.querySelector('.jp-form')).toBeTruthy();
    expect([...c.querySelectorAll('.jp-k')].map((n) => n.textContent)).toEqual(['b', 'a']);
    await asJson();
    expect(c.querySelector('.jp-raw').textContent).toBe(raw);
  });

  it('deep unwraps nested stringified JSON, as JsonHighlight deep always did', async () => {
    const value = { text: '{"inner":{"x":1}}' };
    expect(deepParse(value)).toEqual({ text: { inner: { x: 1 } } });
    const c = pane(<JsonPane value={value} deep />);
    await asJson();
    expect(c.querySelector('.jp-raw').textContent).toContain('"inner"');
    expect(c.querySelector('.jp-raw').textContent).not.toContain('\\"');
    const d = pane(<JsonPane value={value} />);
    expect(d.querySelector('.jp-raw').textContent).toContain('\\"inner\\"');
  });

  it('parseJsonText only accepts objects and arrays', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('[1]')).toEqual([1]);
    expect(parseJsonText('5')).toBeUndefined();
    expect(parseJsonText('{oops}')).toBeUndefined();
    expect(parseJsonText(5)).toBeUndefined();
  });

  const wire = 'POST /token HTTP/1.1\nHost: x\nContent-Type: application/json\n\n{"grant_type":"client_credentials","scope":"a b"}';
  const response = 'HTTP/1.1 400 Bad Request\nContent-Type: application/json\n\n{"error":"invalid_scope"}';

  it('splitWire separates the head from a JSON body and leaves anything else alone', () => {
    expect(splitWire(wire)).toEqual({ head: 'POST /token HTTP/1.1\nHost: x\nContent-Type: application/json', body: '{"grant_type":"client_credentials","scope":"a b"}' });
    expect(splitWire(response).body).toBe('{"error":"invalid_scope"}');
    expect(splitWire('hello\n\n{"a":1}')).toBeUndefined();
    expect(splitWire('POST /x HTTP/1.1\n\nnot json')).toBeUndefined();
    expect(splitWire(5)).toBeUndefined();
  });

  it('an HTTP transcript keeps its headers as text and gives the body its own Form | JSON pane', async () => {
    const c = pane(<JsonPane value={wire} label="Request" />);
    expect(c.querySelector('.jp-raw--head').textContent).toContain('POST /token HTTP/1.1');
    expect(c.querySelector('.jp-form')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Form' })).toHaveLength(1);
    await asJson();
    expect(c.querySelector('.jp-box .jp-raw').textContent).toBe('{"grant_type":"client_credentials","scope":"a b"}');
  });
});

describe('JsonPane: guards and hostile text', () => {
  it('shows a payload over the size guard as plain text (no colour, no form, no switch)', () => {
    const big = { blob: 'x'.repeat(MAX_PANE_CHARS) };
    const c = pane(<JsonPane value={big} />);
    expect(c.querySelector('[data-view="text"]')).toBeTruthy();
    expect(c.querySelector('.jp-tok')).toBeNull();
    expect(c.querySelector('.jp-form')).toBeNull();
    expect(within(c).queryByRole('button')).toBeNull();
  });

  it('renders a payload just under the size guard in full', () => {
    const c = pane(<JsonPane value={{ blob: 'x'.repeat(MAX_PANE_CHARS - 100) }} />);
    expect(c.querySelector('[data-view="form"]')).toBeTruthy();
  });

  it('stops the Form view at the depth guard and shows the rest as text, without throwing', () => {
    let deep = { leaf: 'end' };
    for (let i = 0; i < MAX_FORM_DEPTH + 10; i += 1) deep = { n: deep };
    const c = pane(<JsonPane value={deep} />);
    expect(c.querySelectorAll('.jp-fields').length).toBeLessThanOrEqual(MAX_FORM_DEPTH + 1);
    expect(c.textContent).toContain('"leaf":"end"');
  });

  it('does not throw on a circular value', () => {
    const loop = { a: 1 };
    loop.self = loop;
    expect(() => pane(<JsonPane value={loop} />)).not.toThrow();
  });

  it('shows control and bidi characters as visible escapes in keys and values, in both views', async () => {
    // built from code points so this file holds no hidden characters itself
    const [rlo, bel, lri, zwsp] = [0x202e, 0x07, 0x2066, 0x200b].map((n) => String.fromCodePoint(n));
    const hostile = { [`k${rlo}ey`]: `va${bel}l${lri}ue${zwsp}`, plain: 'ok' };
    const c = pane(<JsonPane value={hostile} />);
    for (const bad of [rlo, bel, lri, zwsp]) expect(c.textContent).not.toContain(bad);
    expect(c.textContent).toContain('\\u202e');
    expect(c.textContent).toContain('\\u0007');
    expect(c.textContent).toContain('\\u2066');
    expect(c.textContent).toContain('\\u200b');
    await asJson();
    for (const bad of [rlo, bel, lri, zwsp]) expect(c.textContent).not.toContain(bad);
    expect(c.textContent).toContain('\\u202e');
    expect(c.textContent).toContain('\\u2066');
  });

  it('renders markup in a value as text, never as elements', async () => {
    const c = pane(<JsonPane value={{ html: '<img src=x onerror=alert(1)>' }} />);
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    await asJson();
    expect(c.querySelector('img')).toBeNull();
  });
});

describe('JsonPane: full view', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'JsonPane.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const jsx = fs.readFileSync(path.resolve(__dirname, '..', 'JsonPane.jsx'), 'utf8');

  it('the stylesheet never caps or scrolls a pane', () => {
    expect(css).not.toMatch(/overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/);
    for (const m of css.matchAll(/max-height\s*:\s*([^;}]+)/g)) expect(m[1].trim()).toBe('none');
    expect(css).toMatch(/\.jp-raw\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the stylesheet follows the theming rules: tokens only, no OS dark mode, scale sizes', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(css).not.toMatch(/font-size:\s*[0-9.]+(?:px|rem|em)/);
    expect(css).not.toMatch(/border-radius:\s*[0-9.]+(?:px|rem|em)/);
  });

  it('renders no inline style and no raw markup', () => {
    const c = pane(<JsonPane value={TOKEN} label="x" />);
    expect(c.querySelector('[style]')).toBeNull();
    expect(jsx).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('a very long unbroken string stays inside the pane box (no inline width, wraps by CSS)', async () => {
    const c = pane(<JsonPane value={{ s: 'a'.repeat(5000) }} />);
    await asJson();
    expect(c.querySelector('.jp-raw').textContent).toContain('a'.repeat(5000));
  });
});

describe('JsonPane: per-field Copy (Form view)', () => {
  const writeText = vi.fn();
  // Rule 24b: a pane with a JWT also renders decoded copies under it; scope copy-button lookups to the raw pane (the first .jp-box) so the decoded duplicates do not double-match.
  const copyBtn = (c, name) => within([...c.querySelectorAll('.jp-box')][0] || c).getByRole('button', { name });

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('gives every primitive leaf its own Copy button, named for its key', () => {
    const c = pane(<JsonPane value={{ ...TOKEN, access_token: JWT }} label="Claims" />);
    for (const k of ['s', 'sub', 'aud', 'n', 'ok', 'bad', 'site', 'id', 'exp', 'access_token']) {
      expect(copyBtn(c, `Copy ${k}`)).toHaveAttribute('type', 'button');
    }
    expect(within(c).queryByRole('button', { name: 'Copy none' })).toBeNull(); // null shows "none": nothing to copy
  });

  it('copies exactly the data text: string, number, boolean, time, url, id and the whole compact token', async () => {
    const c = pane(<JsonPane value={{ ...TOKEN, access_token: JWT, quoted: '{}' }} />);
    const cases = { s: 'text', n: '42', ok: 'true', bad: 'false', exp: '1893456000', site: 'https://example.com/a', id: '123e4567-e89b-12d3-a456-426614174000', access_token: JWT, quoted: '{}' };
    for (const [k, text] of Object.entries(cases)) {
      writeText.mockClear();
      await userEvent.click(copyBtn(c, `Copy ${k}`));
      expect(writeText).toHaveBeenCalledWith(text);
    }
  });

  it('copies each chip of a list and of a scope string, not the whole list', async () => {
    const c = pane(<JsonPane value={{ scope: 'read write', roles: ['a', 'b'] }} />);
    await userEvent.click(copyBtn(c, 'Copy write'));
    expect(writeText).toHaveBeenLastCalledWith('write');
    await userEvent.click(copyBtn(c, 'Copy b'));
    expect(writeText).toHaveBeenLastCalledWith('b');
    expect(c.querySelectorAll('.jp-chip > .jp-copy')).toHaveLength(4);
  });

  it('copies a masked value as the mask, exactly what is displayed', async () => {
    const c = pane(<JsonPane value={{ client_secret: '********' }} />);
    await userEvent.click(copyBtn(c, 'Copy client_secret'));
    expect(writeText).toHaveBeenCalledWith('********');
  });

  it('says Copied after a copy, then goes back to Copy', async () => {
    const c = pane(<JsonPane value={{ sub: 'user-1' }} />);
    await userEvent.click(copyBtn(c, 'Copy sub'));
    const done = await within(c).findByRole('button', { name: 'Copied sub' });
    expect(done).toHaveTextContent('Copied');
    await waitFor(() => expect(copyBtn(c, 'Copy sub')).toBeTruthy(), { timeout: 3000 });
  });

  it('falls back to a hidden textarea when the clipboard is blocked, and says nothing if that fails too', async () => {
    writeText.mockRejectedValue(new Error('blocked'));
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    const c = pane(<JsonPane value={{ sub: 'user-1' }} />);
    await userEvent.click(copyBtn(c, 'Copy sub'));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(await within(c).findByRole('button', { name: 'Copied sub' })).toBeTruthy();
    expect(document.querySelector('.jp-copy-sink')).toBeNull();
    exec.mockReturnValue(false);
    const d = pane(<JsonPane value={{ sub: 'user-2' }} />);
    await userEvent.click(within(d).getByRole('button', { name: 'Copy sub' }));
    expect(within(d).queryByRole('button', { name: 'Copied sub' })).toBeNull();
    delete document.execCommand;
  });

  it('is reachable by keyboard: a real button in the tab order, activated with Enter', async () => {
    const c = pane(<JsonPane value={{ sub: 'user-1' }} />);
    const b = copyBtn(c, 'Copy sub');
    expect(b.tagName).toBe('BUTTON');
    expect(b).not.toHaveAttribute('tabindex', '-1');
    expect(b).not.toHaveAttribute('hidden');
    expect(b.parentElement.closest('pre, button')).toBeNull(); // never inside a <pre> or inside another button
    await userEvent.tab(); // Form | JSON switch
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab(); // the pane itself (tabIndex 0), then the Copy button
    expect(b).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(writeText).toHaveBeenCalledWith('user-1');
  });

  it('copyFields={false} removes every per-field button and keeps the switch', () => {
    const c = pane(<JsonPane value={{ sub: 'user-1', scope: 'read write', n: 1 }} copyFields={false} />);
    expect(c.querySelector('.jp-copy')).toBeNull();
    expect(within(c).getAllByRole('button')).toHaveLength(2); // Form, JSON
  });

  it('puts no button beside the JSON view, and none in a body pane when copyFields is off', async () => {
    const c = pane(<JsonPane value={{ sub: 'user-1' }} />);
    await asJson();
    expect(c.querySelector('.jp-copy')).toBeNull();
    setJsonView('form');
    const w = pane(<JsonPane copyFields={false} value={'POST /x HTTP/1.1\nHost: a\n\n{"sub":"u"}'} />);
    expect(w.querySelector('.jp-copy')).toBeNull();
  });

  it('an HTTP transcript body pane gets the buttons too', () => {
    const w = pane(<JsonPane value={'POST /x HTTP/1.1\nHost: a\n\n{"sub":"u"}'} />);
    expect(within(w).getByRole('button', { name: 'Copy sub' })).toBeTruthy();
  });

  it('keeps the full view: the stylesheet shows the button on hover / focus and always on touch, and caps nothing', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'JsonPane.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.jp-copy:focus-visible/);
    expect(css).toMatch(/:focus-within\s*>\s*\.jp-copy/);
    expect(css).toMatch(/@media \(hover: none\)\s*\{\s*\.jp-copy\s*\{\s*opacity:\s*1/);
    const rule = css.match(/\.jp-copy\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/background:\s*var\(--th-/);
    expect(rule).toMatch(/\bcolor:\s*var\(--th-/); // a --th background always carries its own colour
    expect(rule).toMatch(/font-size:\s*var\(--font-size-3xs\)/);
  });
});

describe('Rule 24b: decoded tokens under the pane', () => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwtOf = (header, claims, sig = 'c2lnbmF0dXJl') => [b64(header), b64(claims), sig].join('.');
  it('a PingOne-shaped token in a value gets a decoded card: Header, Payload, Signature, named by field', () => {
    const token = jwtOf(
      { alg: 'RS256', kid: 'mock-key-1', typ: 'JWT' },
      { sub: 'u-123', client_id: 'bank-app', aud: ['gateway'], scope: 'openid transfer', act: { sub: 'agent-1' } }
    );
    const c = pane(<JsonPane value={{ access_token: token, token_type: 'Bearer' }} label="Token response" />);
    const card = within(c).getByTestId('decoded-token');
    expect(card.textContent).toMatch(/access_token/);
    for (const h of ['Header', 'Payload', 'Signature']) expect(within(card).getByText(h)).toBeTruthy();
    expect(card.textContent).toMatch(/RS256/);
    expect(card.textContent).toMatch(/u-123/);
    expect(card.textContent).toMatch(/agent-1/);
  });
  it('decode={false} skips the decoded block; a cut-short or non-JWT is skipped; text is never markup', () => {
    const token = jwtOf({ alg: 'none' }, { sub: '<img src=x onerror=alert(1)>' }, '');
    const c = pane(<JsonPane value={{ access_token: token }} decode={false} />);
    expect(within(c).queryByTestId('decoded-tokens')).toBeNull();
    const d = pane(<JsonPane value={{ access_token: token, short: `${token.slice(0, 40)}...` }} />);
    const card = within(d).getByTestId('decoded-token');
    expect(card.textContent).toMatch(/no signature segment/);
    expect(card.querySelector('img, script')).toBeNull();
    expect(d.querySelectorAll('[data-testid="decoded-token"]')).toHaveLength(1);
  });
});
