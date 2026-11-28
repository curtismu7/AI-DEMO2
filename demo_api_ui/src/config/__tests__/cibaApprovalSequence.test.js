import { describe, it, expect } from 'vitest';
import { parseSequence } from '../../utils/parseSequence';
import {
  CIBA_APPROVAL_DETAILS,
  CIBA_APPROVAL_PAYLOADS,
  CIBA_APPROVAL_SOURCE,
  CIBA_APPROVAL_STEP_DETAILS,
} from '../cibaApprovalSequence';

// The CIBA approval sequence: 10 participants, 71 messages in the order of the Lucidchart, drawn by SequenceFlowDiagram from Mermaid text.
// Structural checks only: the wording of each message is the chart's and is reviewed against it, not pinned here.
describe('CIBA approval sequence data', () => {
  const model = parseSequence(CIBA_APPROVAL_SOURCE);
  const messages = model.items.filter((i) => i.type === 'message');
  const flat = (t) => t.replace(/\s+/g, ' ');

  it('has the 10 participants of the chart, left to right, each with a label and a role line', () => {
    expect(model.participants.map((p) => p.id)).toEqual(['user', 'agent', 'aigate', 'mcp', 'gw', 'store', 'pdp', 'as', 'device', 'api']);
    expect(model.participants.map((p) => p.label.split('\n')[0])).toEqual([
      'User (chat widget)', 'Agent runtime', 'AI gateway', 'Flight MCP server', 'API gateway (approval plugin + policy check)',
      'Redis (approval store)', 'PingOne Authorize (PAZ)', 'PingOne (CIBA)', 'Other device (push)', 'Flights API',
    ]);
    for (const p of model.participants) expect(p.label.split('\n').length, p.id).toBe(2);
    expect(model.autonumber).toBe(true);
  });

  it('has the 71 messages, in the order of the chart, solid for calls and dashed for returns', () => {
    expect(messages).toHaveLength(71);
    const at = (n) => messages[n - 1];
    expect([at(1).from, at(1).to, at(1).dashed]).toEqual(['user', 'agent', false]);
    expect(flat(at(7).text)).toMatch(/RFC 8693 token exchange .*aud = approval-gateway.example.com.*scope = flights-api/);
    expect([at(8).from, at(8).to, at(8).dashed]).toEqual(['as', 'mcp', true]);
    expect([at(27).from, at(27).to, at(27).dashed]).toEqual(['pdp', 'gw', true]);
    expect(flat(at(27).text)).toMatch(/DENY 401.*auth_challenge.*acr_values="ciba-approval"/);
    expect(flat(at(29).text)).toMatch(/POST \/as\/cibaAuthorization.*binding_message=BK-XXXX/);
    expect([at(32).from, at(32).to]).toEqual(['gw', 'store']);
    expect(flat(at(32).text)).toBe('SET approval:request');
    expect(flat(at(35).text)).toMatch(/_meta\[com\.example\/approval\]/);
    expect(flat(at(42).text)).toMatch(/POST \/bookings \+ x-ciba-approval: auth_req_id/);
    expect(flat(at(46).text)).toMatch(/grant_type=urn:openid:params:grant-type:ciba/);
    expect(flat(at(50).text)).toBe('ngx.sleep(interval)');
    expect([at(57).from, at(57).to]).toEqual(['gw', 'api']);
    expect(flat(at(63).text)).toBe('final text: booking confirmed');
    expect(flat(at(71).text)).toMatch(/replay again with same auth_req_id/);
    // a message to the same participant is a self-call
    expect(messages.filter((m) => m.from === m.to).map((m) => messages.indexOf(m) + 1)).toEqual([5, 11, 26, 28, 45, 50, 53, 55]);
  });

  it('draws three phase bands, each opened by a banner note, plus the loop with its inner alt and the closing alt', () => {
    expect(CIBA_APPROVAL_SOURCE.match(/^\s*rect rgb\(/gm)).toHaveLength(3);
    const banners = model.items.filter((i) => i.type === 'note' && /^Phase \d - /.test(i.text)).map((i) => i.text);
    expect(banners).toEqual(['Phase 1 - Search (no approval)', 'Phase 2 - Booking write: PAZ requires approval', 'Phase 3 - replay and polling']);
    const frames = model.items.filter((i) => i.type === 'fragment').map((i) => `${i.kind} ${i.text}`.trim());
    expect(frames).toEqual(['loop poll every interval, up to hold_seconds', 'alt user approves', 'else still pending', 'alt denied or expired', 'else still pending']);
    // every rect / frame is closed
    const opens = (CIBA_APPROVAL_SOURCE.match(/^\s*(rect|alt|loop)\b/gm) || []).length;
    expect((CIBA_APPROVAL_SOURCE.match(/^\s*end\s*$/gm) || []).length).toBe(opens);
  });

  it('has the 7 yellow notes of the chart besides the banners', () => {
    const notes = model.items.filter((i) => i.type === 'note' && !/^Phase \d - /.test(i.text));
    expect(notes).toHaveLength(7);
    expect(notes.map((n) => n.over)).toEqual([['gw'], ['mcp'], ['agent'], ['user'], ['mcp'], ['gw'], ['gw']]);
    expect(notes[0].text).toMatch(/approval plugin \(priority 1001\)/);
  });

  it('has no payload boxes under the messages: the wire text lives in the step details', () => {
    expect(CIBA_APPROVAL_PAYLOADS).toEqual([]);
  });

  it('has a role description for every participant', () => {
    for (const p of model.participants) {
      expect(CIBA_APPROVAL_DETAILS[p.id], p.id).toBeTruthy();
      expect(CIBA_APPROVAL_DETAILS[p.id].length, p.id).toBeLessThan(400);
    }
  });
});

describe('CIBA approval sequence step details', () => {
  const REF = /^(RFC \d{3,5}|CIBA Core 1\.0|OIDC Core 1\.0|MCP)$/;
  const START = /^[A-Z]{3,10} \/\S* HTTP\/1\.1$/;
  const STATUS = /^HTTP\/1\.1 \d{3}( .+)?$/;

  it('has one detail per message, 71 in all', () => {
    expect(CIBA_APPROVAL_STEP_DETAILS).toHaveLength(71);
  });

  it('says what happens and why for every step, each within 600 characters', () => {
    CIBA_APPROVAL_STEP_DETAILS.forEach((d, i) => {
      expect(d.what, `step ${i + 1} what`).toBeTruthy();
      expect(d.why, `step ${i + 1} why`).toBeTruthy();
      expect(d.what.length, `step ${i + 1} what length`).toBeLessThanOrEqual(600);
      expect(d.why.length, `step ${i + 1} why length`).toBeLessThanOrEqual(600);
    });
  });

  it('cites at least one standard per step, in the known forms', () => {
    CIBA_APPROVAL_STEP_DETAILS.forEach((d, i) => {
      expect(d.refs.length, `step ${i + 1} refs`).toBeGreaterThanOrEqual(1);
      expect(d.refs.length, `step ${i + 1} refs`).toBeLessThanOrEqual(5);
      for (const r of d.refs) {
        expect(r.spec, `step ${i + 1}`).toMatch(REF);
        if (r.section !== undefined) expect(r.section).toMatch(/^[A-Za-z0-9.-]{1,16}$/);
        if (r.note !== undefined) expect(r.note.length).toBeLessThanOrEqual(160);
      }
    });
  });

  it('writes each request and response as wire text: a start line, header lines, then an optional body after a blank line', () => {
    let requests = 0; let responses = 0;
    CIBA_APPROVAL_STEP_DETAILS.forEach((d, i) => {
      if (d.request) { requests++; const [first, host] = d.request.split('\n'); expect(first, `step ${i + 1} request`).toMatch(START); expect(host).toMatch(/^Host: \S+$/); }
      if (d.response) { responses++; expect(d.response.split('\n')[0], `step ${i + 1} response`).toMatch(STATUS); }
    });
    expect(requests).toBeGreaterThan(20);
    expect(responses).toBeGreaterThan(20);
  });

  it('shows the token exchange, the 401 challenge, the CIBA request and the poll on the wire', () => {
    const d = (n) => CIBA_APPROVAL_STEP_DETAILS[n - 1];
    expect(d(7).request).toMatch(/^POST \/ENV_ID\/as\/token HTTP\/1\.1/);
    expect(d(7).request).toMatch(/grant_type=urn:ietf:params:oauth:grant-type:token-exchange/);
    expect(d(27).response).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
    expect(d(27).response).toMatch(/WWW-Authenticate: .*acr_values="ciba-approval"/);
    expect(d(29).request).toMatch(/POST \/ENV_ID\/as\/cibaAuthorization HTTP\/1\.1/);
    expect(d(29).request).toMatch(/binding_message=BK-XXXX/);
    expect(d(46).request).toMatch(/grant_type=urn:openid:params:grant-type:ciba/);
    expect(d(42).request).toMatch(/x-ciba-approval: /);
  });

  it('decodes the tokens as header and payload objects with a label', () => {
    const withTokens = CIBA_APPROVAL_STEP_DETAILS.filter((d) => d.tokens);
    expect(withTokens.length).toBeGreaterThan(5);
    for (const d of withTokens) for (const t of d.tokens) {
      expect(t.label).toBeTruthy();
      expect(t.header.alg).toBe('RS256');
      expect(t.payload.sub).toBeTruthy();
    }
  });

  it('names a source file only where this repo has one, and marks the rest as outside it', () => {
    const named = CIBA_APPROVAL_STEP_DETAILS.map((d, i) => [i + 1, d.source]).filter(([, s]) => s);
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const [, s] of named) expect(s).toMatch(/^(demo_api_server|demo_authz_server|ping-gateway|docs)\/[\w./-]+$/);
    expect(CIBA_APPROVAL_DETAILS.gw).toMatch(/outside this repo/);
    expect(CIBA_APPROVAL_DETAILS.mcp).toMatch(/outside this repo/);
  });

  it('leaves an open question only where there really is one', () => {
    const open = CIBA_APPROVAL_STEP_DETAILS.map((d, i) => [i + 1, d.open]).filter(([, o]) => o);
    expect(open.map(([n]) => n)).toEqual([2, 27, 31]);
  });

  it('keeps fake values only: no real-looking secret, token or tenant id', () => {
    const all = JSON.stringify(CIBA_APPROVAL_STEP_DETAILS);
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(all).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});
