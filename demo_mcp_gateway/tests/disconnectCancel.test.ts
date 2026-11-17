import { cancelOnDisconnect, abortOnDisconnect } from '../src/disconnectCancel';

describe('cancelOnDisconnect: which calls a dropped connection may abort', () => {
  it.each(['create_deposit', 'create_withdrawal', 'create_transfer', 'create_wire_transfer'])(
    'never aborts the money-moving tool %s',
    (tool) => expect(cancelOnDisconnect('tools/call', tool)).toBe(false),
  );

  it.each(['update_contact_email', 'request_fee_waiver', 'submit_expense', 'pay_airline_fee'])(
    'never aborts the write tool %s',
    (tool) => expect(cancelOnDisconnect('tools/call', tool)).toBe(false),
  );

  it.each(['get_my_accounts', 'get_account_balance', 'get_investment_balance'])(
    'aborts the read-only tool %s',
    (tool) => expect(cancelOnDisconnect('tools/call', tool)).toBe(true),
  );

  it('does not abort a tool the scope manifest does not know', () => {
    expect(cancelOnDisconnect('tools/call', 'some_new_tool')).toBe(false);
  });

  it('does not abort a tools/call with no tool name, or a missing method', () => {
    expect(cancelOnDisconnect('tools/call', undefined)).toBe(false);
    expect(cancelOnDisconnect(undefined, 'get_my_accounts')).toBe(false);
  });

  it.each(['tools/list', 'resources/list', 'resources/read', 'prompts/get', 'completion/complete'])(
    'aborts the read-only method %s',
    (method) => expect(cancelOnDisconnect(method)).toBe(true),
  );

  it('does not abort other methods', () => {
    expect(cancelOnDisconnect('initialize')).toBe(false);
    expect(cancelOnDisconnect('logging/setLevel')).toBe(false);
  });
});

describe('abortOnDisconnect', () => {
  it('aborts only the cancellable calls and reports both counts', () => {
    const read = { controller: new AbortController(), cancelOnDisconnect: true };
    const money = { controller: new AbortController(), cancelOnDisconnect: false };

    expect(abortOnDisconnect([read, money])).toEqual({ cancelled: 1, kept: 1 });
    expect(read.controller.signal.aborted).toBe(true);
    expect(money.controller.signal.aborted).toBe(false);
  });

  it('is a no-op with nothing in flight', () => {
    expect(abortOnDisconnect([])).toEqual({ cancelled: 0, kept: 0 });
  });
});
