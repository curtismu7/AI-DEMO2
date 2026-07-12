'use strict';

/**
 * The admin dashboard's Customer Admin picker selects a customer client-side
 * only — there's no server session state for it, so the SPA resends
 * { customer: { id, name } } on every admin chat turn. applyAdminCustomerContext
 * fills userId/accountId from it so "View Profile" etc. don't dead-end on
 * "I need: User ID" after a picker selection.
 */

const { __test } = require('../services/demoAgentLangGraphService');
const { applyAdminCustomerContext } = __test;

const userIdToolDef = { inputSchema: { properties: { userId: { type: 'string' } }, required: ['userId'] } };
const accountIdToolDef = { inputSchema: { properties: { accountId: { type: 'string' }, amount: { type: 'number' } }, required: ['accountId', 'amount'] } };
const queryToolDef = { inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } };

function reqWithCustomer(customer) {
  return { body: { customer } };
}

describe('applyAdminCustomerContext', () => {
  test('non-admin vertical: params pass through unchanged', () => {
    const params = { foo: 'bar' };
    expect(applyAdminCustomerContext('banking', params, userIdToolDef, reqWithCustomer({ id: '1', name: 'John Doe' })))
      .toBe(params);
  });

  test('no customer on the request: params pass through unchanged', () => {
    const params = {};
    expect(applyAdminCustomerContext('admin', params, userIdToolDef, { body: {} }))
      .toBe(params);
  });

  test('fills userId from the picker-selected customer when the tool declares it', () => {
    expect(applyAdminCustomerContext('admin', {}, userIdToolDef, reqWithCustomer({ id: '1', name: 'John Doe' })))
      .toEqual({ userId: '1' });
  });

  test('does not override an explicitly parsed userId', () => {
    expect(applyAdminCustomerContext('admin', { userId: '99' }, userIdToolDef, reqWithCustomer({ id: '1' })))
      .toEqual({ userId: '99' });
  });

  test('leaves params alone when the tool does not declare userId or accountId (e.g. lookup_customer)', () => {
    const params = { query: 'doe' };
    expect(applyAdminCustomerContext('admin', params, queryToolDef, reqWithCustomer({ id: '1' })))
      .toEqual({ query: 'doe' });
  });

  test('accountId is left unset when the customer has no accounts (store lookup returns empty)', () => {
    // No accounts seeded for this fake id — best-effort default only, must not throw.
    expect(applyAdminCustomerContext('admin', { amount: 100 }, accountIdToolDef, reqWithCustomer({ id: 'no-such-user' })))
      .toEqual({ amount: 100 });
  });
});
