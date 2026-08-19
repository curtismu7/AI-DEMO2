'use strict';
import { RETAIL_TOOLS, dispatchRetailTool } from '../src/tools/retailTools';
import { SPORTING_GOODS_TOOLS, dispatchSportingGoodsTool } from '../src/tools/sportingGoodsTools';
import { UNIVERSITY_TOOLS, dispatchUniversityTool } from '../src/tools/universityTools';
import { WORKFORCE_TOOLS, dispatchWorkforceTool } from '../src/tools/workforceTools';
import { ANF_TOOLS, dispatchAnfTool } from '../src/tools/anfTools';

function checkConformance(tools: any[], scope: string) {
  expect(tools.length).toBe(2);
  for (const t of tools) {
    expect(t.description.length).toBeGreaterThan(10);
    expect(Array.isArray(t.intentHints)).toBe(true);
    expect(t.intentHints.length).toBeGreaterThanOrEqual(3);
    expect(t.requiredScopes).toContain(scope);
  }
}

describe('Retail tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of RETAIL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
      // Retail was read-only until checkout was routed here, so a blanket
      // "requires read" no longer describes the set. Assert the scope matches
      // what the tool actually does — scope-topology.json is the SoT and lists
      // checkout as "write".
      expect(t.requiredScopes).toContain(t.readOnly === false ? 'write' : 'read');
    }
  });
  it('checkout places an order that the very next list_orders returns', async () => {
    // The end-to-end shape of the divergence fix, at the handler boundary:
    // the write and the read go through the same dispatcher and the same DB.
    const before = await dispatchRetailTool('list_orders', {}) as any;
    const placed = await dispatchRetailTool('checkout', { product: 'Studio Monitor', amount: 799 }) as any;

    expect(placed.render).toBe('checkout');
    expect(placed.status).toBe('Processing');
    expect(placed.product).toBe('Studio Monitor');
    expect(placed.amount).toBe(799);

    const after = await dispatchRetailTool('list_orders', {}) as any;
    expect(after.orders).toHaveLength(before.orders.length + 1);
    expect(after.orders.some((o: any) => o.id === placed.id)).toBe(true);
  });

  it('checkout defaults product and amount like the BFF did (consent-showcase chips carry neither)', async () => {
    const placed = await dispatchRetailTool('checkout', {}) as any;
    expect(placed.product).toBe('Headphones');
    expect(placed.amount).toBe(100);
  });

  it('list_orders returns orders array, stamped for the chip-facing manifest descriptor', async () => {
    const r = await dispatchRetailTool('list_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
    expect(r.render).toBe('list_orders');
  });
  it('order_status with an explicit orderId returns that order, flat, matching the BFF shape', async () => {
    const list = (await dispatchRetailTool('list_orders', {}) as any).orders;
    const r = await dispatchRetailTool('order_status', { orderId: list[0].id }) as any;
    expect(r.id).toBe(list[0].id);
    expect(r.render).toBe('order_status');
    expect(r.order).toBeUndefined(); // flat, not {found,order} nested
  });
  it('order_status with no orderId defaults to the most recent order (DB is ORDER BY date DESC)', async () => {
    const list = (await dispatchRetailTool('list_orders', {}) as any).orders;
    const r = await dispatchRetailTool('order_status', {}) as any;
    expect(r.id).toBe(list[0].id);
  });
  it('order_status returns a plain error for an unknown id, not the old {found:false} shape', async () => {
    const r = await dispatchRetailTool('order_status', { orderId: 'no-such-order' }) as any;
    expect(r.error).toBe('order not found');
    expect(r.found).toBeUndefined();
  });
});

describe('Sporting-goods tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of SPORTING_GOODS_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
      expect(t.requiredScopes).toContain('read');
    }
  });
  it('list_gear returns orders array, stamped for the chip-facing manifest descriptor', async () => {
    const r = await dispatchSportingGoodsTool('list_gear', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.render).toBe('list_gear');
  });
  it('gear_order_status with an explicit orderId returns that order, flat', async () => {
    const list = (await dispatchSportingGoodsTool('list_gear', {}) as any).orders;
    const r = await dispatchSportingGoodsTool('gear_order_status', { orderId: list[0].id }) as any;
    expect(r.id).toBe(list[0].id);
    expect(r.render).toBe('gear_order_status');
    expect(r.order).toBeUndefined();
  });
  it('gear_order_status with no orderId defaults to the most recent order', async () => {
    const list = (await dispatchSportingGoodsTool('list_gear', {}) as any).orders;
    const r = await dispatchSportingGoodsTool('gear_order_status', {}) as any;
    expect(r.id).toBe(list[0].id);
  });
});

describe('University tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of UNIVERSITY_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
    }
    expect(UNIVERSITY_TOOLS.find((t) => t.name === 'view_courses')?.requiredScopes).toContain('read');
    expect(UNIVERSITY_TOOLS.find((t) => t.name === 'get_course')?.requiredScopes).toContain('university:read');
  });
  it('view_courses returns courses array, stamped for the chip-facing manifest descriptor', async () => {
    const r = await dispatchUniversityTool('view_courses', {}) as any;
    expect(Array.isArray(r.courses)).toBe(true);
    expect(r.courses[0]).toHaveProperty('id');
    expect(r.render).toBe('view_courses');
  });
  it('get_course returns one by id', async () => {
    const list = (await dispatchUniversityTool('view_courses', {}) as any).courses;
    const r = await dispatchUniversityTool('get_course', { course_id: list[0].id }) as any;
    expect(r.course.id).toBe(list[0].id);
  });
});

// workforce and abercrombie-fitch differ from healthcare/government/manufacturing/
// university: their SQLite tool name is ALREADY the chip-facing name (list_expenses,
// list_anf_orders) — no rename, just a router.ts entry so it stops falling through
// to 'olb' and getting shadowed by the BFF's identically-named handler.
describe('Workforce tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of WORKFORCE_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
    }
    expect(WORKFORCE_TOOLS.find((t) => t.name === 'list_expenses')?.requiredScopes).toContain('read');
    // Write tool routed here 2026-08-19 — gated on write, per scope-topology.json.
    expect(WORKFORCE_TOOLS.find((t) => t.name === 'submit_expense')?.requiredScopes).toContain('write');
    expect(WORKFORCE_TOOLS.find((t) => t.name === 'get_expense')?.requiredScopes).toContain('workforce:read');
  });
  it('submit_expense files an expense the very next list_expenses returns', async () => {
    const before = await dispatchWorkforceTool('list_expenses', {}) as any;
    const filed = await dispatchWorkforceTool('submit_expense', { category: 'Lodging', amount: 425 }) as any;

    expect(filed.render).toBe('submit_expense');
    expect(filed.status).toBe('Submitted');
    expect(filed.category).toBe('Lodging');
    expect(filed.amount).toBe(425);

    const after = await dispatchWorkforceTool('list_expenses', {}) as any;
    expect(after.expenses).toHaveLength(before.expenses.length + 1);
    expect(after.expenses.some((e: any) => e.id === filed.id)).toBe(true);
  });

  it('submit_expense defaults category and amount like the BFF did', async () => {
    const filed = await dispatchWorkforceTool('submit_expense', {}) as any;
    expect(filed.category).toBe('Travel');
    expect(filed.amount).toBe(100);
  });

  it('list_expenses returns expenses array, stamped for the chip-facing manifest descriptor', async () => {
    const r = await dispatchWorkforceTool('list_expenses', {}) as any;
    expect(Array.isArray(r.expenses)).toBe(true);
    expect(r.expenses[0]).toHaveProperty('id');
    expect(r.render).toBe('list_expenses');
  });
  it('get_expense returns one by id', async () => {
    const list = (await dispatchWorkforceTool('list_expenses', {}) as any).expenses;
    const r = await dispatchWorkforceTool('get_expense', { expense_id: list[0].id }) as any;
    expect(r.expense.id).toBe(list[0].id);
  });
});

describe('ANF tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of ANF_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
    }
    expect(ANF_TOOLS.find((t) => t.name === 'list_anf_orders')?.requiredScopes).toContain('read');
    expect(ANF_TOOLS.find((t) => t.name === 'get_anf_order')?.requiredScopes).toContain('anf:read');
  });
  it('list_anf_orders returns orders array, stamped for the chip-facing manifest descriptor', async () => {
    const r = await dispatchAnfTool('list_anf_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
    expect(r.render).toBe('list_anf_orders');
  });
  it('get_anf_order returns one by id', async () => {
    const list = (await dispatchAnfTool('list_anf_orders', {}) as any).orders;
    const r = await dispatchAnfTool('get_anf_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});
