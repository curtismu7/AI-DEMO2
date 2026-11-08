import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayClaimsPage from '../GatewayClaimsPage';
import { parseSequence } from '../../utils/parseSequence';
import {
  AGENT_ID, DIAGRAM_DETAILS, NEXT_DETAILS, NEXT_SCENARIOS, REQUIRED_CLAIMS, SCENARIOS, TIER_RULES,
  evaluateCedarScope, evaluatePfRequest, evaluateRule, evaluateTiers, flattenClaims, nextScenarioDiagram, nextWire, scenarioDiagram,
} from '../../config/gatewayClaims';
import {
  CHECKED_ON, IMAGE_COMPARE, IMAGE_DIGESTS, LATEST_FACTS, NOT_MEASURED, PAGE_VERSIONS, RECHECK_STEPS, RELEASE_DATE, RELEASE_TABLE, SINCE_ROWS, VERSION_LATEST, VERSION_MIDDLE, VERSION_THIRD,
} from '../../config/gatewayLatest';
import { AGENTCORE_FACTS } from '../../config/gatewayAgentcore';
import { DIAGRAMS_INDEX } from '../../config/diagramsIndex';
import { NAV_PAGE_PATHS } from '../../config/navPagePaths';
import { NAV_SEARCH_ALIASES } from '../../config/navSearchAliases';
import measured from './gatewayV1261102.measured.json';

const sourceOf = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('flattenClaims', () => {
  it('flattens nested objects to dotted paths', () => {
    expect(flattenClaims({ a: 1, act: { sub: 'x', deep: { n: 2 } } })).toEqual({ a: 1, 'act.sub': 'x', 'act.deep.n': 2 });
  });
  it('keeps the TEXT "{}" as a leaf, so act.sub does not exist', () => {
    const flat = flattenClaims({ act: '{}' });
    expect(flat).toEqual({ act: '{}' });
    expect('act.sub' in flat).toBe(false);
  });
  it('keeps arrays as leaves and tolerates empty input', () => {
    expect(flattenClaims({ aud: ['a', 'b'] })).toEqual({ aud: ['a', 'b'] });
    expect(flattenClaims(undefined)).toEqual({});
  });
});

describe('scenario evidence labels', () => {
  it('marks only the match run VERIFIED; the "{}" text was never isolated from the mistyped value', () => {
    const ev = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.evidence]));
    expect(ev.match).toBe('verified');
    expect(ev['act-text']).toBe('inferred');
    expect(Object.values(ev).filter((e) => e === 'verified')).toHaveLength(1);
  });
});

describe('evaluateRule scenarios', () => {
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.result]));
  it('allows only the matching token', () => {
    expect(Object.entries(by).filter(([, r]) => r.allowed).map(([id]) => id)).toEqual(['match']);
  });
  it('names the failing claim in the log line', () => {
    expect(by['wrong-act-sub'].log).toBe('workload token rejected: required claim "act.sub" does not match');
    expect(by['act-text'].log).toContain('"act.sub"');
    expect(by['no-act'].log).toContain('"act.sub"');
    expect(by['wrong-client'].log).toContain('"client_id"');
  });
  it('reports a missing claim as not present', () => {
    const c = evaluateRule(REQUIRED_CLAIMS, { client_id: AGENT_ID }).checks.find((k) => k.path === 'act.sub');
    expect(c).toMatchObject({ present: false, ok: false });
  });
  it('requires every claim, not just one', () => {
    expect(evaluateRule({ a: '1', b: '2' }, { a: '1', b: 'x' }).allowed).toBe(false);
  });
});

describe('scenario diagrams', () => {
  it.each(SCENARIOS.map((s) => [s.id, s]))('%s parses with one payload per message and reel details', (_, s) => {
    const d = scenarioDiagram(s);
    const model = parseSequence(d.source);
    const messages = model.items.filter((i) => i.from && i.to);
    expect(messages).toHaveLength(s.result.allowed ? 8 : 7);
    expect(d.payloads).toHaveLength(messages.length);
    for (const p of model.participants) expect(DIAGRAM_DETAILS[p.id]).toBeTruthy();
  });
  it('contains no real-looking hosts or ids', () => {
    const all = SCENARIOS.map((s) => scenarioDiagram(s).source + JSON.stringify(s.claims)).join('\n');
    expect(all).not.toMatch(/ping-devops|pf-route-c-test|cmuir/);
  });
});

describe('v1.261027 models', () => {
  it('Cedar scope gate: denies SearchIndexTool without opensearch:search only when the policy is Active', () => {
    const deny = evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid opensearch:admin', state: 'Active' });
    expect(deny).toMatchObject({ allowed: false, status: 400, rpcCode: -32600 });
    expect(deny.message).toContain('action denied by policy');
    expect(evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid opensearch:admin opensearch:search', state: 'Active' }).allowed).toBe(true);
    expect(evaluateCedarScope({ tool: 'ListIndexTool', scopes: 'openid', state: 'Active' }).allowed).toBe(true);
  });
  it('a candidate policy (State "") only shadows: allowed, with the shadow log', () => {
    const r = evaluateCedarScope({ tool: 'SearchIndexTool', scopes: 'openid', state: '' });
    expect(r).toMatchObject({ allowed: true, status: 200, wouldDeny: true, event: 'mcp_policy_shadow_delta' });
  });
  it('PingFederate: scope= alone gets the wrong token manager and a 401; resource= gets the right one', () => {
    expect(evaluatePfRequest({ param: 'scope' })).toMatchObject({ allowed: false, status: 401, aud: 'enduser.ping.demo', hasSubAct: false });
    expect(evaluatePfRequest({ param: 'scope' }).log).toContain('token_not_found');
    expect(evaluatePfRequest({ param: 'resource' })).toMatchObject({ allowed: true, status: 200, hasSubAct: true });
  });
  it('tiers: admin 9 tools, read 3, neither 403; the scope is matched per value, never as the whole string', () => {
    expect(evaluateTiers({ scope: 'openid opensearch:admin' })).toMatchObject({ allowed: true, count: 9 });
    expect(evaluateTiers({ scope: 'openid opensearch:read' })).toMatchObject({ allowed: true, count: 3 });
    expect(evaluateTiers({ scope: 'openid' })).toMatchObject({ allowed: false, status: 403 });
    expect(evaluateTiers({ scope: 'openid opensearch:read', rules: [{ name: 'w', tools: ['x'], requiredScopes: ['openid opensearch:read'] }] }).status).toBe(403);
    expect(TIER_RULES).toHaveLength(2);
  });
  it('every scenario is labelled VERIFIED, has a diagram with one payload per message, and reel details for each lane', () => {
    expect(NEXT_SCENARIOS.every((s) => s.evidence === 'verified')).toBe(true);
    for (const s of NEXT_SCENARIOS) {
      const d = nextScenarioDiagram(s);
      const model = parseSequence(d.source);
      const messages = model.items.filter((i) => i.from && i.to);
      expect(d.payloads).toHaveLength(messages.length);
      for (const p of model.participants) expect(NEXT_DETAILS[p.id]).toBeTruthy();
    }
  });
  it('contains no real-looking hosts or ids', () => {
    const all = NEXT_SCENARIOS.map((s) => nextScenarioDiagram(s).source + JSON.stringify(nextWire(s))).join('\n');
    expect(all).not.toMatch(/ping-devops|pf-route-c-test|cmuir|01d89b06/);
  });
});

describe('v1.261029, v1.261030 and v1.261102 config', () => {
  it('quotes the same version list the nav, hub card, diagram index and path map use', () => {
    expect(PAGE_VERSIONS).toBe(`v1.261024, v1.261027, v1.261028, ${VERSION_MIDDLE}, ${VERSION_THIRD} and ${VERSION_LATEST}`);
    expect(VERSION_LATEST).toBe('v1.261102');
    expect(RELEASE_TABLE.map((r) => r.tag)).toEqual(['v1.261028', VERSION_MIDDLE, VERSION_THIRD, VERSION_LATEST]);
    const indexed = [...DIAGRAMS_INDEX.flatMap((g) => g.items)].find((d) => d.path === '/gateway-claims');
    expect(indexed.title).toContain(PAGE_VERSIONS);
    expect(Object.entries(NAV_PAGE_PATHS).find(([, path]) => path === '/gateway-claims')[0]).toContain(PAGE_VERSIONS);
    expect(sourceOf('../../components/AdminSideNav.jsx')).toContain(`label: "Gateway ${PAGE_VERSIONS}: Claims"`);
    expect(sourceOf('../../components/LearningHub.tsx')).toContain(`What gateway ${PAGE_VERSIONS} added`);
  });
  it('lists every version in the page version list in both search-alias sources, so searching a version finds the page', () => {
    const versions = PAGE_VERSIONS.match(/v1\.\d{6}/g);
    expect(versions).toHaveLength(6);
    for (const v of versions) {
      expect(NAV_SEARCH_ALIASES['/gateway-claims'], `navSearchAliases lacks ${v}`).toContain(v);
    }
    const nav = sourceOf('../../components/AdminSideNav.jsx');
    const entry = nav.slice(nav.indexOf('path: "/gateway-claims"'), nav.indexOf('path: "/gateway-claims"') + 900);
    const alias = entry.slice(entry.indexOf('searchAlias:'), entry.indexOf('\n', entry.indexOf('searchAlias:')));
    for (const v of versions) expect(alias, `AdminSideNav searchAlias lacks ${v}`).toContain(v);
  });
  it('words the evidence for parts 5 and 6 without overclaiming', () => {
    const byStart = (start) => LATEST_FACTS.find((f) => f.text.startsWith(start));
    const se = byStart('Our SE mesh is mixed-version');
    expect(se.evidence).toBe('verified');
    expect(se.text).toMatch(/Gateway 2 \(the namespace we rolled: gateway container only, explicit tag, not latest\) ran v1\.261102: its pod became ready \(10 of 10 containers, 0 restarts\) and its log tail was empty/);
    expect(se.text).toMatch(/Gateway 1, the front node in a different namespace, still runs v1\.261030, and the public hostname may route to either node/);
    expect(se.text).toMatch(/returned 6 tools, the same as the 2026-11-01 baseline, once through the public gateway hostname with the worker key and once sent straight to gateway 2/);
    expect(se.text).toMatch(/did not compare with a second, lower-entitled key, and we tried no release feature/);
    // Neither node is said to run the new tag alone, the old "not repeated" wording is gone, and no earlier attempt is mentioned.
    expect(se.text).not.toMatch(/\bour SE gateway (now )?runs v1\.261102/i);
    expect(se.text).not.toMatch(/did not repeat|not repeated/i);
    expect(se.text).not.toMatch(/\bfail(ed|ure)?\b|rolled back|rollback|attempt/i);
    expect(se.text).not.toMatch(/\b(works|working|supports|proves)\b/i);
    const stale = JSON.stringify({ LATEST_FACTS, NOT_MEASURED, RECHECK_STEPS });
    expect(stale).not.toMatch(/did not repeat tools\/list|not repeated|has not been repeated/i);
    expect(byStart('We looked at Ping').text).toMatch(/checked, not found/);
    const inferred = LATEST_FACTS.filter((f) => f.evidence === 'inferred');
    expect(inferred).toHaveLength(1);
    expect(inferred[0].text).toMatch(/inference/);
    expect(LATEST_FACTS.filter((f) => f.evidence === 'verified').every((f) => !/\bSo none\b/.test(f.text))).toBe(true);
    // The part 5 statement about the gateway tag is dated; part 6 says the SE gateway has moved on.
    expect(AGENTCORE_FACTS[0].text).toMatch(/Superseded for our two SE gateways: on 2026-11-02 gateway 2 ran v1\.261102 and gateway 1 still runs v1\.261030/);
    expect(AGENTCORE_FACTS[0].text).not.toMatch(/our SE gateway: it now runs/);
  });
  it('names the three scopes of the tier baseline, and keeps the release-features row\'s wording', () => {
    const layers = NOT_MEASURED.find((r) => r.id === 'layers');
    expect(layers.test).toMatch(/opensearch:admin: 9 tools.*opensearch:read: 3 tools.*neither \(openid alone\): 403/);
    expect(SINCE_ROWS.find((r) => r.id === 'release-features').reading).toMatch(/^No symbol or message matches entitlement-aware discovery, aggregate cap, OBO redeem or scope layers/);
  });
  it('never claims a binary reading as verified: every row is a reading and every release feature is UNVERIFIED', () => {
    expect(SINCE_ROWS.length).toBeGreaterThanOrEqual(8);
    expect(SINCE_ROWS.every((r) => r.change && r.symbols && r.reading)).toBe(true);
    expect(NOT_MEASURED.map((r) => r.id)).toEqual(['discovery', 'cap', 'obo', 'layers', 'hold']);
    expect(NOT_MEASURED.every((r) => r.test.length > 40)).toBe(true);
    expect(LATEST_FACTS.filter((f) => f.evidence === 'unverified')).toHaveLength(1);
    expect(RECHECK_STEPS).toHaveLength(3);
    expect(CHECKED_ON).toBe('2026-11-02');
    expect(RELEASE_DATE).toBe('2026-11-02');
  });
  it('states the registry facts: both index digests, latest still on v1.261030, and no newer tag', () => {
    expect(IMAGE_DIGESTS[VERSION_THIRD]).toBe('sha256:62037874a437b4fb60c85f5f7f889909e9fdb66b9f27558002f331917ee98298');
    expect(IMAGE_DIGESTS[VERSION_LATEST]).toBe('sha256:36d29c0a0ea0575706819f23f2783e4f3a6aeb5f604d6d1717de66333b8eae47');
    const tags = LATEST_FACTS[0];
    expect(tags.evidence).toBe('verified');
    expect(tags.text).toMatch(/no tag newer than v1\.261102/);
    expect(tags.text).toMatch(/latest is still the same image as v1\.261030/);
    expect(IMAGE_COMPARE.map((r) => r.id)).toEqual(['digest', 'built', 'layers', 'size', 'binaries', 'config']);
    expect(IMAGE_COMPARE[0].a).toBe(IMAGE_DIGESTS[VERSION_THIRD]);
    expect(IMAGE_COMPARE[0].b).toBe(IMAGE_DIGESTS[VERSION_LATEST]);
    expect(RELEASE_TABLE[3]).toMatchObject({ tag: 'v1.261102', binary: '244,584,504' });
  });
  it('says the two newest binaries differ by named additions only, and keeps every v1.261102 row a reading', () => {
    const rows = SINCE_ROWS.filter((r) => r.version === VERSION_LATEST);
    expect(rows.map((r) => r.id)).toEqual(['idp-claims', 'unplaced', 'rebuild-1102', 'release-features-1102']);
    expect(rows.find((r) => r.id === 'rebuild-1102').reading).toMatch(/^Apart from the rows above, the two binaries show no meaningful difference/);
    expect(rows.find((r) => r.id === 'idp-claims').symbols).toMatch(/withIDPClaims.*carries no usable claims/);
    expect(rows.find((r) => r.id === 'release-features-1102').reading).toMatch(/cannot tie them to any of the five/);
    expect(rows.every((r) => !/\b(verified|proven|confirmed)\b/i.test(r.reading))).toBe(true);
  });
  it('holds no tenant ids, customer names or secrets', () => {
    const all = JSON.stringify({ LATEST_FACTS, IMAGE_COMPARE: IMAGE_COMPARE.filter((r) => r.id !== 'digest'), RELEASE_TABLE, SINCE_ROWS, NOT_MEASURED, RECHECK_STEPS });
    expect(all).not.toMatch(/ping-devops|cmuir|pf-route-c-test|01d89b06|sha256:|\bdoors?\b/i);
  });
});

describe('v1.261102 measured values: the config and the rendered page match the recorded measurements', () => {
  const fmt = (n) => n.toLocaleString('en-US');
  const cells = (row) => within(row).getAllByRole('cell').map((c) => c.textContent);
  const renderPart6 = () => {
    render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);
    return screen.getByTestId('gwc-since');
  };
  const imageRow = (id) => cells(screen.getByTestId(`gwc-image-${id}`));
  const buildRow = (tag) => {
    const row = within(screen.getByTestId('gwc-builds')).getAllByRole('row').find((r) => within(r).queryByText(tag));
    return cells(row);
  };

  it('digests and build times: right tag in the right column, and the same build time in both tables', () => {
    expect(IMAGE_DIGESTS).toEqual(measured.digests);
    renderPart6();
    expect(imageRow('digest').slice(1)).toEqual([measured.digests[VERSION_THIRD], measured.digests[VERSION_LATEST]]);
    expect(imageRow('built').slice(1)).toEqual([measured.built[VERSION_THIRD], measured.built[VERSION_LATEST]]);
    expect(buildRow(VERSION_THIRD)[1]).toBe(measured.built[VERSION_THIRD]);
    expect(buildRow(VERSION_LATEST)[1]).toBe(measured.built[VERSION_LATEST]);
  });
  it('layers: the counts add up to the total and the differing layers named are as many as are counted', () => {
    const { total, identical, differing } = measured.layers;
    expect(identical + differing).toBe(total);
    renderPart6();
    const [, a, b] = imageRow('layers');
    expect(a).toBe(String(total));
    expect(b).toMatch(new RegExp(`^${total}, of which ${identical} are byte-identical`));
    expect(b).toMatch(new RegExp(`The ${differing} that differ are (.+)$`));
    const named = b.match(/The \d+ that differ are (.+)$/)[1].split(/, | and /);
    expect(named).toHaveLength(differing);
  });
  it('sizes: compressed layers and binaries, each in its own column', () => {
    renderPart6();
    const size = (t) => `${fmt(measured.compressedBytes[t].amd64)} and ${fmt(measured.compressedBytes[t].arm64)}`;
    expect(imageRow('size').slice(1)).toEqual([size(VERSION_THIRD), size(VERSION_LATEST)]);
    const bin = (t) => `${fmt(measured.binaryBytes[t].mcpgw)} and ${fmt(measured.binaryBytes[t].cyctl)}`;
    expect(imageRow('binaries').slice(1)).toEqual([bin(VERSION_THIRD), bin(VERSION_LATEST)]);
    for (const [tag, b] of Object.entries(measured.binaryBytes)) expect(buildRow(tag)[2], tag).toBe(fmt(b.mcpgw));
  });
  it('swagger: the operation and definition counts are in the verified fact and on the page', () => {
    const text = `${fmt(measured.swagger.operations)} operations and ${fmt(measured.swagger.definitions)} definitions`;
    expect(LATEST_FACTS.find((f) => f.text.startsWith('The console API spec')).text).toContain(text);
    expect(renderPart6().textContent).toContain(text);
  });
  it('symbols: the raw counts, the compiler-temporary split and the seven named additions all agree', () => {
    const s = measured.symbols[VERSION_LATEST];
    expect(s.namedAdded).toHaveLength(s.added - s.compilerTemporariesEach);
    renderPart6();
    const named = s.added - s.compilerTemporariesEach;
    const expected = `${s.added} added, ${s.removed} removed (${s.compilerTemporariesEach} of each are compiler temporaries, so ${named} named added, ${s.removed - s.compilerTemporariesEach} named removed)`;
    expect(buildRow(VERSION_LATEST)[3]).toBe(expected);
    const row = screen.getByTestId('gwc-since-idp-claims').textContent;
    for (const name of s.namedAdded) expect(row, name).toMatch(new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`));
    expect(screen.getByTestId('gwc-since-rebuild-1102').textContent).toContain('workloadid.ErrNotJWT');
  });
  it('the 6-tool baseline is quoted for v1.261030 and is the count in the SE line', () => {
    const n = `${measured.tools.baselineCount} tools`;
    expect(LATEST_FACTS.find((f) => f.text.startsWith('Our SE mesh')).text).toContain(`returned ${n}`);
    expect(NOT_MEASURED.find((r) => r.id === 'discovery').test).toContain(`${n} on ${VERSION_THIRD}`);
    expect(RECHECK_STEPS[2]).toContain(`(${n} on ${VERSION_THIRD} and on ${VERSION_LATEST})`);
  });
  it('part 6 heading and sub-headings carry the right evidence tag: UNVERIFIED for readings, VERIFIED for registry facts', () => {
    const since = renderPart6();
    expect(within(since).getByRole('heading', { level: 2 }).textContent).toMatch(/UNVERIFIED$/);
    const h3 = within(since).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(h3.find((t) => /^What changed since/.test(t))).toMatch(/UNVERIFIED$/);
    const images = h3.find((t) => /^The two newest images/.test(t));
    expect(images).toMatch(/ VERIFIED$/);
    expect(images).not.toMatch(/UNVERIFIED/);
  });
  it('never says a release feature works, on the page or in the facts', () => {
    const since = renderPart6();
    const text = `${since.textContent} ${screen.getByTestId('gwc-not-measured').textContent}`;
    expect(text).not.toMatch(/\bworks\b|\bproven\b|\bproves\b|\bfeatures? (work|worked|is working|are working|is supported|are supported)\b/i);
    expect(text).not.toMatch(/\bour SE gateway (now )?runs v1\.261102/i);
    expect(text).not.toMatch(/did not repeat|not repeated/i);
  });
});

describe('GatewayClaimsPage', () => {
  const renderPage = () => render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);

  it('has the title, back link, evidence legend and both parts', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /What Privilege gateway v1\.261024, v1\.261027, v1\.261028, v1\.261029, v1\.261030 and v1\.261102 added/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
    const legend = screen.getByTestId('gwc-legend');
    for (const l of ['VERIFIED', 'INFERRED', 'UNVERIFIED']) expect(within(legend).getByText(l)).toBeTruthy();
    expect(screen.getByTestId('gwc-posture').textContent).toMatch(/UNVERIFIED, not yet in the console API/);
    expect(screen.getByTestId('gwc-what-changed').textContent).toMatch(/binary symbol diff/i);
  });

  it('shows parts 6 and 7: what changed since v1.261028 and the unmeasured 2026-11-02 release features, all UNVERIFIED', () => {
    renderPage();
    const since = screen.getByTestId('gwc-since');
    expect(within(since).getByRole('heading', { level: 2 }).textContent).toMatch(/6\. Since v1\.261028: v1\.261029, v1\.261030 and v1\.261102/);
    expect(since.textContent).toMatch(/We found no Ping release notes for these tags .*tried none of their features/);
    expect(within(screen.getByTestId('gwc-builds')).getAllByRole('row')).toHaveLength(RELEASE_TABLE.length + 1);
    const images = within(screen.getByTestId('gwc-image-compare'));
    expect(images.getAllByRole('row')).toHaveLength(IMAGE_COMPARE.length + 1);
    expect(images.getByText(IMAGE_DIGESTS[VERSION_LATEST])).toBeTruthy();
    expect(images.getByText(IMAGE_DIGESTS[VERSION_THIRD])).toBeTruthy();
    expect(within(screen.getByTestId('gwc-since-diff')).getAllByRole('row')).toHaveLength(SINCE_ROWS.length + 1);
    expect(within(screen.getByTestId('gwc-since-rejected-hold')).getByText(/RememberRejected/)).toBeTruthy();
    const nm = screen.getByTestId('gwc-not-measured');
    expect(nm.textContent).toMatch(/do not describe the 2026-11-02 Agent Privilege release/);
    expect(nm.textContent).toMatch(/not confirmed that v1\.261102/);
    expect(since.textContent).toMatch(/became ready/);
    expect(nm.textContent).toMatch(/Gateway 2 of our SE mesh ran v1\.261102 and gateway 1 still runs v1\.261030/);
    for (const f of NOT_MEASURED) {
      const row = within(screen.getByTestId(`gwc-nm-${f.id}`));
      expect(row.getByText(f.feature)).toBeTruthy();
      expect(row.getByText('UNVERIFIED')).toBeTruthy();
    }
    expect(within(screen.getByTestId('gwc-not-measured-table')).queryAllByText('VERIFIED')).toHaveLength(0);
  });

  it('never says "door" in copy', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/\bdoors?\b/i);
  });

  it('switches scenario: verdict, flattened table and diagram follow', () => {
    renderPage();
    expect(screen.getByTestId('gwc-verdict').getAttribute('data-allowed')).toBe('true');
    fireEvent.click(screen.getByTestId('gwc-scenario-act-text'));
    expect(screen.getByTestId('gwc-verdict').getAttribute('data-allowed')).toBe('false');
    expect(screen.getByTestId('gwc-token').textContent).toContain('"act": "{}"');
    expect(within(screen.getByTestId('gwc-checks')).getAllByText('no match').length).toBe(1);
    fireEvent.click(screen.getByTestId('gwc-scenario-match'));
    expect(within(screen.getByTestId('gwc-flat')).getByText('act.sub')).toBeTruthy();
  });

  it('shows the v1.261027 section, says novelty is undiffed, and labels both results VERIFIED', () => {
    renderPage();
    const sec = screen.getByTestId('gwc-next-release');
    expect(within(sec).getByText(/Newer gateway: v1\.261027/)).toBeTruthy();
    expect(sec.textContent).toContain('Binary symbol diff of the gateway image v1.261024 against v1.261027');
    expect(within(sec).getAllByText('VERIFIED').length).toBe(2);
    expect(within(screen.getByTestId('gwc-diff')).getByText(/aipolicy\.Request\.ApprovalAction/)).toBeTruthy();
    expect(within(screen.getByTestId('gwc-diff')).getByText(/cannot say it is new in this tag/)).toBeTruthy();
    expect(screen.getByTestId('gwc-cedar').textContent).toContain('context.token.scopes.contains("opensearch:search")');
    expect(sec.textContent).toContain('State "Active"');
  });

  it('runs the v1.261027 lab: groups, verdict, full request, token, response and the shadow trap', () => {
    renderPage();
    const lab = screen.getByTestId('gwc-next-lab');
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('400');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('-32600');
    expect(within(lab).getByTestId('gwc-next-request').textContent).toContain('"tools/call"');
    fireEvent.click(screen.getByTestId('gwc-next-cedar-candidate'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-allowed')).toBe('true');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('mcp_policy_shadow_delta');
    fireEvent.click(screen.getByTestId('gwc-group-pf'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('401');
    expect(within(lab).getByTestId('gwc-next-response').textContent).toContain('enduser.ping.demo');
    fireEvent.click(screen.getByTestId('gwc-next-pf-resource'));
    expect(within(lab).getByTestId('gwc-next-request').textContent).toContain('resource=');
    fireEvent.click(screen.getByTestId('gwc-group-tiers'));
    fireEvent.click(screen.getByTestId('gwc-next-tier-none'));
    expect(within(lab).getByTestId('gwc-next-verdict').getAttribute('data-status')).toBe('403');
  });

  it('labels every cell of a stacked table, so the narrow layout keeps its column headings', () => {
    const { container } = renderPage();
    const stacked = container.querySelectorAll('table.gwc-table--stack');
    expect(stacked.length).toBeGreaterThanOrEqual(9);
    stacked.forEach((t) => {
      const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent);
      t.querySelectorAll('tbody tr').forEach((row) => {
        [...row.children].forEach((td, i) => expect(td.getAttribute('data-label')).toBe(heads[i]));
      });
    });
  });
});

describe('GatewayClaimsPage on the Ping UI Standard', () => {
  const renderPage = () => render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);

  it('puts the simulation banner first, above the title, and says nothing is called', () => {
    const { container } = renderPage();
    const banner = screen.getByTestId('gwc-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.textContent).toMatch(/SIMULATED, NO LIVE CALL/);
    expect(banner.textContent).toMatch(/Only statements labelled VERIFIED were seen on a real system/);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.pu-page').firstElementChild.className).toBe('pu-banner-wrap');
  });

  it('uses native radio groups for every picker, one checked per group, each named by its label', () => {
    const { container } = renderPage();
    const groups = new Set([...container.querySelectorAll('input[type=radio]')].map((r) => r.name));
    expect([...groups].sort()).toEqual(['gwc-ag-case', 'gwc-ag-group', 'gwc-next-group', 'gwc-next-run', 'gwc-scenario']);
    for (const name of groups) {
      const radios = [...container.querySelectorAll(`input[type=radio][name="${name}"]`)];
      expect(radios.filter((r) => r.checked)).toHaveLength(1);
      radios.forEach((r) => expect(r.closest('label').textContent.trim().length).toBeGreaterThan(0));
    }
    expect(container.querySelectorAll('fieldset.gwc-choices legend')).toHaveLength(groups.size);
    fireEvent.click(screen.getByTestId('gwc-scenario-no-act'));
    expect(screen.getByTestId('gwc-scenario-no-act').checked).toBe(true);
    expect(screen.getByTestId('gwc-scenario-match').checked).toBe(false);
  });

  it('never titles a simulated or replayed result as a gateway verdict', () => {
    const { container } = renderPage();
    for (const id of ['gwc-verdict', 'gwc-ag-verdict']) {
      expect(within(screen.getByTestId(id)).getByRole('heading', { level: 3 }).textContent).toBe('Simulated verdict');
    }
    expect(within(screen.getByTestId('gwc-next-verdict')).getByRole('heading', { level: 3 }).textContent).toBe('Replay of a measured run');
    const labels = [...container.querySelectorAll('.sfx[role=group]')].map((g) => g.getAttribute('aria-label'));
    expect(labels).toHaveLength(3);
    labels.forEach((l) => expect(l).toMatch(/^Simulated /));
    container.querySelectorAll('h2').forEach((h) => expect(h.textContent).not.toMatch(/^\d\. Gateway\b/));
  });

  it('gives every status chip a word and every verdict a chip with the outcome', () => {
    const { container } = renderPage();
    const chips = [...container.querySelectorAll('.pu-chip')];
    expect(chips.length).toBeGreaterThan(20);
    chips.forEach((c) => expect(c.textContent.trim().length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('gwc-verdict')).getByText('ALLOW: HTTP 200').className).toContain('pu-chip');
    expect(within(screen.getByTestId('gwc-next-verdict')).getByText(/^DENY: HTTP 400$/).className).toContain('pu-chip');
  });

  it('has exactly one primary: Part 1 walkthrough, styled in the page sheet; no other primary class anywhere on the page', () => {
    const { container } = renderPage();
    const hooks = container.querySelectorAll('.gwc-sim-primary');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].closest('[data-testid=gwc-posture]')).toBeNull();
    expect(hooks[0].querySelector('.dstep-bar')).toBeTruthy();
    expect(container.querySelectorAll('.gwc-page [class*="primary"]:not(.gwc-sim-primary)')).toHaveLength(0);
    const css = sourceOf('../GatewayClaimsPage.css');
    expect(css).toMatch(/\.gwc-sim-primary \.dstep-bar \.dc-ctrl-btn--simulate:not\(:disabled\)/);
    expect(css).toMatch(/var\(--btn-accent-gradient\)/);
    expect(css).not.toMatch(/--app-primary-red|--brand-|--theme-accent/);
  });

  it('keeps the page sheet free of literal colours and inline styles in the part files', () => {
    const css = sourceOf('../GatewayClaimsPage.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    for (const f of ['../GatewayClaimsPage.jsx', '../GatewayNextLab.jsx', '../GatewayAgentcoreLab.jsx', '../GatewayLatest.jsx', '../../components/gatewayClaims/parts.jsx']) {
      expect(sourceOf(f), f).not.toMatch(/style=\{\{/);
    }
  });
});
