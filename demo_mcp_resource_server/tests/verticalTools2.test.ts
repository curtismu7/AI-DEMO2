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
  it('conforms', () => checkConformance(RETAIL_TOOLS, 'retail:read'));
  it('list_orders returns orders array', async () => {
    const r = await dispatchRetailTool('list_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
  });
  it('get_order returns one by id', async () => {
    const list = (await dispatchRetailTool('list_orders', {}) as any).orders;
    const r = await dispatchRetailTool('get_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});

describe('Sporting-goods tools', () => {
  it('conforms', () => checkConformance(SPORTING_GOODS_TOOLS, 'sporting-goods:read'));
  it('list_gear_orders returns orders array', async () => {
    const r = await dispatchSportingGoodsTool('list_gear_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
  });
  it('get_gear_order returns one by id', async () => {
    const list = (await dispatchSportingGoodsTool('list_gear_orders', {}) as any).orders;
    const r = await dispatchSportingGoodsTool('get_gear_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});

describe('University tools', () => {
  it('conforms', () => checkConformance(UNIVERSITY_TOOLS, 'university:read'));
  it('list_courses returns courses array', async () => {
    const r = await dispatchUniversityTool('list_courses', {}) as any;
    expect(Array.isArray(r.courses)).toBe(true);
    expect(r.courses[0]).toHaveProperty('id');
  });
  it('get_course returns one by id', async () => {
    const list = (await dispatchUniversityTool('list_courses', {}) as any).courses;
    const r = await dispatchUniversityTool('get_course', { course_id: list[0].id }) as any;
    expect(r.course.id).toBe(list[0].id);
  });
});

describe('Workforce tools', () => {
  it('conforms', () => checkConformance(WORKFORCE_TOOLS, 'workforce:read'));
  it('list_expenses returns expenses array', async () => {
    const r = await dispatchWorkforceTool('list_expenses', {}) as any;
    expect(Array.isArray(r.expenses)).toBe(true);
    expect(r.expenses[0]).toHaveProperty('id');
  });
  it('get_expense returns one by id', async () => {
    const list = (await dispatchWorkforceTool('list_expenses', {}) as any).expenses;
    const r = await dispatchWorkforceTool('get_expense', { expense_id: list[0].id }) as any;
    expect(r.expense.id).toBe(list[0].id);
  });
});

describe('ANF tools', () => {
  it('conforms', () => checkConformance(ANF_TOOLS, 'anf:read'));
  it('list_anf_orders returns orders array', async () => {
    const r = await dispatchAnfTool('list_anf_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
  });
  it('get_anf_order returns one by id', async () => {
    const list = (await dispatchAnfTool('list_anf_orders', {}) as any).orders;
    const r = await dispatchAnfTool('get_anf_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});
