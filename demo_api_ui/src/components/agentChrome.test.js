import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  buildPingOneAppListMessage,
  buildPingOneToolListMessage,
  buildPingOneUserListMessage,
  cibaUseCaseFor,
  HitlChipMark,
  verticalSuggestionChips,
} from './agentChrome';

describe('cibaUseCaseFor', () => {
  const manifest = { dashboard: { chips10: [
    { message: 'transfer $600 from checking to savings with CIBA approval', useCaseId: 'ciba-out-of-band-approval' },
    { message: 'transfer $600 from checking to savings', useCaseId: 'step-up-required' },
  ] } };
  test('typed CIBA chip text carries the CIBA use case', () => {
    expect(cibaUseCaseFor(' Transfer $600 from checking to savings with CIBA approval ', manifest)).toBe('ciba-out-of-band-approval');
  });
  test('other chips and free text carry nothing', () => {
    expect(cibaUseCaseFor('transfer $600 from checking to savings', manifest)).toBeUndefined();
    expect(cibaUseCaseFor('with CIBA approval', manifest)).toBeUndefined();
    expect(cibaUseCaseFor('anything', null)).toBeUndefined();
  });
  test('every **CIBA** welcome prompt in a vertical greeting resolves to the CIBA use case', () => {
    const manifests = import.meta.glob('../../../demo_api_server/config/verticals/*/manifest.json', { eager: true, import: 'default' });
    const cibaPrompts = Object.values(manifests).flatMap((m) =>
      [...(m.agent?.greeting || '').matchAll(/^- \*\*CIBA\*\*: "(.+)"$/gm)].map(([, p]) => [p, m]));
    expect(cibaPrompts.length).toBeGreaterThanOrEqual(3);
    for (const [p, m] of cibaPrompts) expect(cibaUseCaseFor(p, m)).toBe('ciba-out-of-band-approval');
  });
});

describe('HitlChipMark challenge markers', () => {
  test('consent → 👤 only', () => {
    const { container } = render(<HitlChipMark challenge="consent" />);
    expect(container.textContent).toContain('👤');
    expect(container.textContent).not.toContain('🔑');
  });
  test('both → 👤🔑', () => {
    const { container } = render(<HitlChipMark challenge="both" />);
    expect(container.textContent).toContain('👤');
    expect(container.textContent).toContain('🔑');
  });
  test('step_up → 🔑 only', () => {
    const { container } = render(<HitlChipMark challenge="step_up" />);
    expect(container.textContent).toContain('🔑');
    expect(container.textContent).not.toContain('👤');
  });
  test('verticalSuggestionChips carries challenge', () => {
    const chips = verticalSuggestionChips({ dashboard: { chips10: [{ id: 'a', label: 'A', message: 'a', challenge: 'both', queryPrompt: 'userFilter' }] } });
    expect(chips[0].challenge).toBe('both');
    expect(chips[0].queryPrompt).toBe('userFilter');
  });
});

describe('buildPingOneUserListMessage', () => {
  test('maps all to an unfiltered listUsers request', () => {
    expect(buildPingOneUserListMessage('all')).toContain('no filter');
  });

  test('maps a trailing wildcard to a PingOne starts-with filter', () => {
    expect(buildPingOneUserListMessage('curtis*')).toContain('username sw "curtis"');
  });

  test('rejects unsupported wildcard shapes', () => {
    expect(buildPingOneUserListMessage('*curtis')).toBeNull();
  });
});

describe('buildPingOneToolListMessage', () => {
  test('all maps to the proven catalog phrase, never the chip title', () => {
    // The chip title contains "MCP", which an earlier banking heuristic
    // (mcp_tools) would claim — the built message must avoid it.
    const msg = buildPingOneToolListMessage('all');
    expect(msg).toBe('What PingOne tools can I use right now?');
    expect(msg).not.toMatch(/MCP/);
  });

  test('a fragment maps to the matching-phrase the admin heuristic extracts', () => {
    expect(buildPingOneToolListMessage('user')).toContain('matching "user"');
    // Trailing asterisk is tolerated UI sugar, not part of the fragment.
    expect(buildPingOneToolListMessage('user*')).toContain('matching "user"');
  });

  test('rejects fragments outside the safe charset', () => {
    expect(buildPingOneToolListMessage('a b')).toBeNull();
  });
});

describe('buildPingOneAppListMessage', () => {
  test('maps all to an unfiltered listApplications request', () => {
    expect(buildPingOneAppListMessage('all')).toContain('no filter');
  });

  test('maps a trailing wildcard to a case-preserved name sw filter', () => {
    // Case matters: PingOne SCIM sw is case-sensitive, "Demo" must not
    // arrive lowercased.
    expect(buildPingOneAppListMessage('Demo*')).toContain('name sw "Demo"');
  });

  test('rejects unsupported wildcard shapes', () => {
    expect(buildPingOneAppListMessage('*Demo')).toBeNull();
  });
});
