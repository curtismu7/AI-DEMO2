'use strict';

/**
 * Phase 3: ONE source of truth for the conversational system prompt.
 * Five provider paths previously duplicated this string inline; the Helix
 * copy had drifted (hardcoded "banking demo platform", ignored the vertical).
 */

const { __test } = require('../../services/geminiNlIntent');

describe('conversationalSystemPrompt', () => {
  it('is exported for reuse', () => {
    expect(typeof __test.conversationalSystemPrompt).toBe('function');
  });

  it('defaults to banking', () => {
    expect(__test.conversationalSystemPrompt({})).toBe(
      "You are a knowledgeable assistant for a banking platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.",
    );
  });

  it('uses the active vertical with dashes humanized', () => {
    expect(__test.conversationalSystemPrompt({ vertical: 'sporting-goods' }))
      .toContain('for a sporting goods platform');
  });

  it('ignores non-string vertical values', () => {
    expect(__test.conversationalSystemPrompt({ vertical: 42 })).toContain('for a banking platform');
    expect(__test.conversationalSystemPrompt({ vertical: '' })).toContain('for a banking platform');
  });

  it('is the ONLY definition — no inline duplicates remain in the module source', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/geminiNlIntent.js'), 'utf8');
    const matches = src.match(/knowledgeable assistant/g) || [];
    expect(matches).toHaveLength(1); // the helper itself
  });
});
