// banking_agent_service/tests/greatBuyChips.helix.test.ts
//
// E2E-style tests for Great Buy (retail domain) chip routing via the Helix LLM path.
// Verifies that:
//   - Helix produces retail-domain TOOL_CALLs for Great Buy chip messages
//   - Multi-turn round-trips (chip → tool call → result → summary) stay retail-domain
//   - Helix fallback (no tool needed) produces retail prose, never banking data
//   - Unknown-tool retry resolves to a valid Great Buy tool, not a banking tool
//
// Uses fake callHelix clients (zero network) — deterministic, CI-safe.

import { helixReason, HelixUnparseableError } from '../src/helixToolAdapter';
import type { ReasonToolSchema, ReasonMessage } from '../src/reasonContract';

// ── Great Buy tool catalog ────────────────────────────────────────────────────

const GREAT_BUY_TOOLS: ReasonToolSchema[] = [
  {
    name: 'get_my_orders',
    description: 'List recent customer orders from the Great Buy retail platform',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_loyalty_points',
    description: 'Return current Great Buy loyalty (rewards) point balance',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_return_status',
    description: 'Check the status of a product return or exchange request',
    inputSchema: {
      type: 'object',
      properties: { order_id: { type: 'string', description: 'Order ID to check return for' } },
    },
  },
  {
    name: 'find_stores_near_me',
    description: 'Find Great Buy store locations near the customer',
    inputSchema: { type: 'object', properties: { zip: { type: 'string' } } },
  },
  {
    name: 'search_products',
    description: 'Search the Great Buy product catalog by keyword or category',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
    },
  },
  {
    name: 'get_product_recommendations',
    description: 'Return personalized product recommendations based on purchase history',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(GREAT_BUY_TOOLS.map((t) => t.name));
const BANKING_TOOL_NAMES = new Set([
  'get_my_accounts',
  'get_my_balance',
  'create_transfer',
  'get_transactions',
  'get_routing_number',
  'get_sensitive_details',
]);

// ── helpers ───────────────────────────────────────────────────────────────────

function fakeSingleTurn(response: string) {
  return async (_cfg: unknown, _msgs: ReasonMessage[]): Promise<string> => response;
}

function fakeTwoTurn(turn1: string, turn2: string) {
  let n = 0;
  return async (_cfg: unknown, _msgs: ReasonMessage[]): Promise<string> => {
    n += 1;
    return n === 1 ? turn1 : turn2;
  };
}

// ── Helix routing for every Great Buy chip ────────────────────────────────────

describe('Great Buy Helix chips — each chip resolves to a retail tool call', () => {
  const CHIP_TO_TOOL: Array<[id: string, message: string, tool: string]> = [
    ['orders',         'show my orders',                    'get_my_orders'],
    ['loyalty',        'check my loyalty points',           'get_loyalty_points'],
    ['return_status',  'check my return status',            'get_return_status'],
    ['store_locator',  'find stores near me',               'find_stores_near_me'],
    ['product_search', 'find me the best 4K TV under $600', 'search_products'],
    ['recommendations','what products would you recommend?','get_product_recommendations'],
  ];

  test.each(CHIP_TO_TOOL)(
    'chip "%s" → Helix emits TOOL_CALL for %s (retail, not banking)',
    async (_id, message, expectedTool) => {
      const fn = fakeSingleTurn(`TOOL_CALL: {"name":"${expectedTool}","args":{}}`);
      const out = await helixReason({}, [{ role: 'user', content: message }], GREAT_BUY_TOOLS, fn);

      expect(out.tool_calls).toBeDefined();
      expect(out.tool_calls![0].name).toBe(expectedTool);
      expect(TOOL_NAMES.has(out.tool_calls![0].name)).toBe(true);
      expect(BANKING_TOOL_NAMES.has(out.tool_calls![0].name)).toBe(false);
    },
  );
});

describe('Great Buy Helix chips — multi-turn round-trip (C-1 contract)', () => {
  // After the BFF executes a Great Buy tool, the result MUST reach Helix on the
  // second turn so it can summarise in retail-domain language.

  it('get_my_orders: order list (GB-* IDs) reaches Helix and triggers a retail summary', async () => {
    const seenPrompts: string[] = [];
    const ordersResult = JSON.stringify([
      { id: 'GB-1024', product: 'Sony WH-1000XM5', status: 'delivered', amount: 349.99 },
      { id: 'GB-1025', product: 'USB-C 7-port Hub', status: 'in_transit', amount: 39.99 },
    ]);

    const fn = fakeTwoTurn(
      'TOOL_CALL: {"name":"get_my_orders","args":{}}',
      'You have 2 recent Great Buy orders: Sony WH-1000XM5 (delivered, $349.99) and a USB-C Hub (in transit, $39.99).',
    );

    const capturingFn = async (cfg: unknown, msgs: ReasonMessage[]): Promise<string> => {
      const last = [...msgs].reverse().find((m) => m.role === 'user');
      seenPrompts.push(last ? last.content : '');
      return fn(cfg, msgs);
    };

    const r1 = await helixReason(
      {},
      [{ role: 'user', content: 'show my orders' }],
      GREAT_BUY_TOOLS,
      capturingFn,
    );
    expect(r1.tool_calls?.[0].name).toBe('get_my_orders');

    const turn2Msgs: ReasonMessage[] = [
      { role: 'user', content: 'show my orders' },
      { role: 'assistant', content: '', tool_calls: r1.tool_calls },
      { role: 'tool', content: ordersResult, tool_call_id: r1.tool_calls![0].id },
    ];
    const r2 = await helixReason({}, turn2Msgs, GREAT_BUY_TOOLS, capturingFn);

    // Helix must have seen the tool result (C-1).
    expect(seenPrompts.length).toBe(2);
    expect(seenPrompts[1]).toContain('TOOL RESULT');
    expect(seenPrompts[1]).toContain('GB-1024');
    expect(seenPrompts[1]).toContain('Sony WH-1000XM5');

    // Final answer: retail-domain, no banking.
    expect(r2.content).toMatch(/great buy|order|delivered|in.transit/i);
    expect(r2.content).not.toMatch(/\b(account number|routing|balance|transfer)\b/i);
    expect(r2.tool_calls).toBeUndefined();
  });

  it('get_loyalty_points: rewards data reaches Helix and triggers a points summary', async () => {
    const seenPrompts: string[] = [];
    const loyaltyResult = JSON.stringify({
      points: 8120,
      tier: 'Platinum',
      nextTierAt: 10000,
      expiresAt: '2026-12-31',
    });

    const fn = fakeTwoTurn(
      'TOOL_CALL: {"name":"get_loyalty_points","args":{}}',
      'Your Great Buy Platinum Rewards balance is 8,120 points. Earn 1,880 more to unlock Elite status.',
    );
    const capturingFn = async (cfg: unknown, msgs: ReasonMessage[]): Promise<string> => {
      const last = [...msgs].reverse().find((m) => m.role === 'user');
      seenPrompts.push(last ? last.content : '');
      return fn(cfg, msgs);
    };

    const r1 = await helixReason(
      {},
      [{ role: 'user', content: 'check my loyalty points' }],
      GREAT_BUY_TOOLS,
      capturingFn,
    );
    expect(r1.tool_calls?.[0].name).toBe('get_loyalty_points');

    const turn2Msgs: ReasonMessage[] = [
      { role: 'user', content: 'check my loyalty points' },
      { role: 'assistant', content: '', tool_calls: r1.tool_calls },
      { role: 'tool', content: loyaltyResult, tool_call_id: r1.tool_calls![0].id },
    ];
    const r2 = await helixReason({}, turn2Msgs, GREAT_BUY_TOOLS, capturingFn);

    expect(seenPrompts[1]).toContain('Platinum');
    expect(seenPrompts[1]).toContain('8120');
    expect(r2.content).toMatch(/platinum|rewards|points|elite/i);
    expect(r2.content).not.toMatch(/\b(savings|checking|account number|routing)\b/i);
    expect(r2.tool_calls).toBeUndefined();
  });

  it('search_products: product list reaches Helix and triggers a retail recommendation summary', async () => {
    const seenPrompts: string[] = [];
    const searchResult = JSON.stringify([
      { sku: 'GB-TV-4K-55', name: 'Samsung Neo QLED 55"', price: 549.99, rating: 4.7 },
      { sku: 'GB-TV-4K-65', name: 'LG C3 OLED 65"',      price: 599.99, rating: 4.9 },
      { sku: 'GB-TV-4K-TCL', name: 'TCL Q7 65"',          price: 479.99, rating: 4.5 },
    ]);

    const fn = fakeTwoTurn(
      'TOOL_CALL: {"name":"search_products","args":{"query":"4K TV under $600"}}',
      'I found 3 great 4K TVs under $600: Samsung Neo QLED ($549.99, 4.7★), LG C3 OLED ($599.99, 4.9★), and TCL Q7 ($479.99, 4.5★). The LG OLED is the top-rated pick.',
    );
    const capturingFn = async (cfg: unknown, msgs: ReasonMessage[]): Promise<string> => {
      const last = [...msgs].reverse().find((m) => m.role === 'user');
      seenPrompts.push(last ? last.content : '');
      return fn(cfg, msgs);
    };

    const r1 = await helixReason(
      {},
      [{ role: 'user', content: 'find me the best 4K TV under $600' }],
      GREAT_BUY_TOOLS,
      capturingFn,
    );
    expect(r1.tool_calls?.[0].name).toBe('search_products');

    const turn2Msgs: ReasonMessage[] = [
      { role: 'user', content: 'find me the best 4K TV under $600' },
      { role: 'assistant', content: '', tool_calls: r1.tool_calls },
      { role: 'tool', content: searchResult, tool_call_id: r1.tool_calls![0].id },
    ];
    const r2 = await helixReason({}, turn2Msgs, GREAT_BUY_TOOLS, capturingFn);

    expect(seenPrompts[1]).toContain('Samsung Neo QLED');
    expect(seenPrompts[1]).toContain('GB-TV-4K-55');
    expect(r2.content).toMatch(/4K TV|OLED|QLED|TCL/i);
    expect(r2.content).not.toMatch(/\b(account|routing|transfer|deposit|withdraw)\b/i);
    expect(r2.tool_calls).toBeUndefined();
  });
});

describe('Great Buy Helix chips — conversational (no tool call needed)', () => {
  // Some Great Buy chip messages result in a direct conversational Helix response
  // (no tool call) — e.g. store hours, return policy, general questions.

  const CONVERSATIONAL_CHIPS = [
    {
      id: 'return_policy',
      message: "What is Great Buy's return policy?",
      helixResponse:
        'Great Buy offers a 30-day return policy for most items. Electronics must be returned in original packaging. Loyalty members enjoy an extended 60-day return window.',
    },
    {
      id: 'store_hours',
      message: 'What are your store hours?',
      helixResponse:
        'Great Buy stores are open Monday–Saturday 10am–9pm and Sunday 11am–7pm. Holiday hours may vary — check the store locator for your nearest location.',
    },
    {
      id: 'price_match',
      message: 'Do you offer price matching?',
      helixResponse:
        'Yes! Great Buy matches prices from major retail competitors including Amazon, Best Buy, and Walmart within 14 days of purchase.',
    },
  ];

  test.each(CONVERSATIONAL_CHIPS.map((c) => [c.id, c.message, c.helixResponse]))(
    'chip "%s" → Helix returns retail prose (no tool call)',
    async (_id, message, expectedResponse) => {
      const fn = fakeSingleTurn(expectedResponse);
      const out = await helixReason({}, [{ role: 'user', content: message }], GREAT_BUY_TOOLS, fn);

      expect(out.tool_calls).toBeUndefined();
      expect(out.content).toBeDefined();
      expect(out.content).toMatch(/great buy|return|store|price/i);
      expect(out.content).not.toMatch(/\b(account number|routing number|bank|deposit|withdrawal)\b/i);
    },
  );
});

describe('Great Buy Helix chips — error recovery and retry', () => {
  it('hallucinated banking tool → retry resolves to a valid Great Buy tool', async () => {
    const { fn, calls } = (() => {
      const calls: ReasonMessage[][] = [];
      let i = 0;
      const responses = [
        'TOOL_CALL: {"name":"get_my_accounts","args":{}}',         // turn 1: hallucinated banking tool
        'TOOL_CALL: {"name":"get_my_orders","args":{}}',            // turn 2: corrected to retail tool
      ];
      const fn = async (_cfg: unknown, msgs: ReasonMessage[]): Promise<string> => {
        calls.push(msgs);
        return responses[i++];
      };
      return { fn, calls };
    })();

    // Note: get_my_accounts is NOT in GREAT_BUY_TOOLS, so helixReason will
    // retry once and the second response should match a valid tool.
    const out = await helixReason({}, [{ role: 'user', content: 'show my orders' }], GREAT_BUY_TOOLS, fn);

    expect(out.tool_calls?.[0].name).toBe('get_my_orders');
    expect(TOOL_NAMES.has(out.tool_calls![0].name)).toBe(true);
    expect(BANKING_TOOL_NAMES.has(out.tool_calls![0].name)).toBe(false);
    expect(calls.length).toBe(2); // one retry
  });

  it('persistently malformed JSON → throws HelixUnparseableError (no silent banking fallback)', async () => {
    const fn = fakeTwoTurn(
      'TOOL_CALL: {not valid json',
      'TOOL_CALL: {also not valid',
    );

    await expect(
      helixReason({}, [{ role: 'user', content: 'show my orders' }], GREAT_BUY_TOOLS, fn),
    ).rejects.toBeInstanceOf(HelixUnparseableError);
  });

  it('Helix transport failure on product search → HelixUnparseableError surfaces (no silent banking fallback)', async () => {
    const fn = async (): Promise<string> => {
      throw new Error('Helix poll failed: 503 Service Unavailable');
    };

    await expect(
      helixReason({}, [{ role: 'user', content: 'find me a laptop' }], GREAT_BUY_TOOLS, fn),
    ).rejects.toThrow(/Helix poll failed/);
  });
});

describe('Great Buy Helix chips — response domain isolation', () => {
  // Cross-domain contamination guard: even if the request message accidentally
  // included a financial-sounding word, Helix must resolve to a retail tool only.

  it('message with price amount resolves to search_products, not a banking tool', async () => {
    const fn = fakeSingleTurn('TOOL_CALL: {"name":"search_products","args":{"query":"laptop $800"}}');
    const out = await helixReason(
      {},
      [{ role: 'user', content: 'find me a laptop for around $800' }],
      GREAT_BUY_TOOLS,
      fn,
    );

    expect(out.tool_calls?.[0].name).toBe('search_products');
    expect(BANKING_TOOL_NAMES.has(out.tool_calls![0].name)).toBe(false);
  });

  it('message mentioning "balance" in loyalty context resolves to get_loyalty_points', async () => {
    const fn = fakeSingleTurn('TOOL_CALL: {"name":"get_loyalty_points","args":{}}');
    const out = await helixReason(
      {},
      [{ role: 'user', content: 'what is my rewards balance?' }],
      GREAT_BUY_TOOLS,
      fn,
    );

    expect(out.tool_calls?.[0].name).toBe('get_loyalty_points');
    // Must NOT resolve to a banking balance tool (get_my_balance is not in this catalog).
    expect(BANKING_TOOL_NAMES.has(out.tool_calls![0].name)).toBe(false);
  });

  it('Helix prose response for loyalty query contains retail language only', async () => {
    const fn = fakeSingleTurn(
      'Your Great Buy Gold Rewards balance is 3,200 points — worth $32 off your next purchase. Points expire Jan 2027.',
    );
    const out = await helixReason(
      {},
      [{ role: 'user', content: 'what is my rewards balance?' }],
      GREAT_BUY_TOOLS,
      fn,
    );

    expect(out.content).toMatch(/rewards|points|great buy/i);
    expect(out.content).not.toMatch(/\b(account number|routing|savings|checking account)\b/i);
    expect(out.tool_calls).toBeUndefined();
  });
});
