import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  buildPingOneAppListMessage,
  buildPingOneToolListMessage,
  buildPingOneUserListMessage,
  HitlChipMark,
  verticalSuggestionChips,
} from './agentChrome';

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
