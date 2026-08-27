/**
 * @file uiProbe.test.js
 * @description Unit tests for the ad-hoc-probe settle contract.
 *
 * The helper lives in tests/e2e/helpers/ (beside realLogin.js, where a probe
 * author looks for it), but vite.config.js excludes `tests/e2e/**` from vitest,
 * so its spec lives here instead — otherwise nothing would run it.
 *
 * `page` is duck-typed: the helper only ever calls page.evaluate(fn), so a stub
 * that returns scripted samples exercises the real code with no browser.
 */

import { describe, it, expect } from 'vitest';
import {
  settle,
  activeVertical,
  requireVertical,
  ProbeNotSettled,
  WrongVertical,
} from '../../tests/e2e/helpers/uiProbe.js';

/** A page whose successive measurements are scripted; the last one repeats. */
function pageYielding(samples) {
  let i = 0;
  return {
    calls: () => i,
    evaluate: async () => {
      const s = samples[Math.min(i, samples.length - 1)];
      i += 1;
      return s;
    },
  };
}

const blank = { chars: 0, buttons: 0, path: '/dashboard' };
const rendered = { chars: 1381, buttons: 16, path: '/dashboard' };
const fast = { pollMs: 1, quietMs: 5, timeoutMs: 500 };

describe('settle', () => {
  it('returns the measurement once the page renders and holds steady', async () => {
    const page = pageYielding([blank, blank, rendered, rendered, rendered]);
    const seen = await settle(page, fast);
    expect(seen.chars).toBe(1381);
    expect(seen.buttons).toBe(16);
  });

  // False finding #1: the probe sampled before React settled and the route was
  // written up as rendering nothing. A helper that returned {chars: 0} would
  // reproduce that bug; this one must refuse to return at all.
  it('THROWS rather than returning a zero measurement when the page never renders', async () => {
    const page = pageYielding([blank]);
    await expect(settle(page, fast)).rejects.toThrow(ProbeNotSettled);
  });

  it('says the failure is not a finding, and names what it needed', async () => {
    const page = pageYielding([blank]);
    const err = await settle(page, fast).catch((e) => e);
    expect(err.message).toMatch(/NOT a finding/);
    expect(err.message).toMatch(/0 chars/);
    expect(err.message).toMatch(/needed >=200 chars/);
    expect(err.detail).toEqual(blank);
  });

  // The specific trap a single-sample threshold check would fall into: one frame
  // over the floor mid-burst, which then changes again.
  it('does not settle on a single over-threshold frame that then changes', async () => {
    const growing = [
      blank,
      { chars: 400, buttons: 2, path: '/dashboard' },
      { chars: 900, buttons: 9, path: '/dashboard' },
      rendered,
      rendered,
      rendered,
    ];
    const page = pageYielding(growing);
    const seen = await settle(page, fast);
    expect(seen.chars).toBe(1381);
  });

  // A shell that mounts without its children: plenty of text, no controls.
  it('treats a page with text but no controls as unsettled', async () => {
    const page = pageYielding([{ chars: 900, buttons: 0, path: '/dashboard' }]);
    await expect(settle(page, fast)).rejects.toThrow(ProbeNotSettled);
  });

  it('honours a caller-supplied floor', async () => {
    const page = pageYielding([{ chars: 250, buttons: 3, path: '/x' }]);
    await expect(settle(page, { ...fast, minChars: 5000 })).rejects.toThrow(ProbeNotSettled);
    await expect(settle(page, { ...fast, minChars: 100 })).resolves.toMatchObject({ chars: 250 });
  });
});

describe('activeVertical / requireVertical', () => {
  const pageOnVertical = (id) => ({ evaluate: async () => id });

  it('reads the vertical the session actually resolved to', async () => {
    await expect(activeVertical(pageOnVertical('banking'))).resolves.toBe('banking');
  });

  it('passes when the session is on the expected vertical', async () => {
    await expect(requireVertical(pageOnVertical('sporting-goods'), 'sporting-goods'))
      .resolves.toBe('sporting-goods');
  });

  // False finding #2: a retail phrase submitted into a banking session matches
  // nothing, and the missing tool traffic reads as a broken feature.
  it('THROWS when the session resolved elsewhere, naming both verticals', async () => {
    const err = await requireVertical(pageOnVertical('banking'), 'retail').catch((e) => e);
    expect(err).toBeInstanceOf(WrongVertical);
    expect(err.message).toMatch(/"banking"/);
    expect(err.message).toMatch(/"retail"/);
    expect(err.message).toMatch(/mis-targeted probe/);
    expect(err.detail).toEqual({ expected: 'retail', actual: 'banking' });
  });

  it('treats no resolved vertical as a mismatch, not a pass', async () => {
    await expect(requireVertical(pageOnVertical(null), 'banking')).rejects.toThrow(WrongVertical);
  });
});
