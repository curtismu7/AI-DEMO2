'use strict';

/**
 * Regression — the heuristic parser attaches a generic `recordId` (often just the $ amount)
 * that vertical tool schemas don't declare. The generated MCP schema is
 * additionalProperties:false, so an undeclared recordId gets a Gateway HTTP 400. This
 * surfaced only after UC6/7/8 amount chips started reaching the gateway (they previously
 * stalled at the BFF). normalizeVerticalToolArgs strips/maps recordId before dispatch.
 */

const { __test } = require('../services/demoAgentLangGraphService');
const { normalizeVerticalToolArgs } = __test;

const payBillDef = { inputSchema: { properties: { billId: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'], additionalProperties: false } };
const poDef = { inputSchema: { properties: { poId: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] } };
const recordIdDef = { inputSchema: { properties: { recordId: { type: 'string' } } } };

describe('normalizeVerticalToolArgs', () => {
  test('drops a recordId that echoes the amount (amount policy chip → default record)', () => {
    // "pay my $300 bill" → { amount:300, recordId:"300" }
    expect(normalizeVerticalToolArgs({ amount: 300, recordId: '300' }, payBillDef))
      .toEqual({ amount: 300 });
  });

  test('maps a real recordId to the tool id field ("pay bill 402")', () => {
    expect(normalizeVerticalToolArgs({ recordId: '402' }, payBillDef))
      .toEqual({ billId: '402' });
  });

  test('maps recordId to poId for approve_purchase_order', () => {
    expect(normalizeVerticalToolArgs({ recordId: 'po-9' }, poDef))
      .toEqual({ poId: 'po-9' });
  });

  test('leaves args untouched when the tool declares recordId', () => {
    expect(normalizeVerticalToolArgs({ recordId: 'r1' }, recordIdDef))
      .toEqual({ recordId: 'r1' });
  });

  test('no-op when there is no recordId', () => {
    expect(normalizeVerticalToolArgs({ amount: 300, billId: 'b1' }, payBillDef))
      .toEqual({ amount: 300, billId: 'b1' });
  });

  test('does not overwrite an explicit id with recordId', () => {
    expect(normalizeVerticalToolArgs({ billId: 'real', recordId: '999' }, payBillDef))
      .toEqual({ billId: 'real' });
  });
});
