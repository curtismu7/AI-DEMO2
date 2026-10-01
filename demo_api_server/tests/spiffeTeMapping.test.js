'use strict';

/**
 * The SPIFFE exchange's PingFederate access-token mapping must emit the actor's
 * SPIFFE ID as client_id and act.sub, and must stay scoped to aiDemoSpiffeTePolicy:
 * the other PF exchanges (UC40 Step 9) keep their own client_id/act shape.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../../spiffe/pingfederate');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

describe('SPIFFE token-exchange mapping', () => {
  const spiffe = read('spiffe-te-atm-mapping.json');
  const fulfil = spiffe.attributeContractFulfillment;

  it('is scoped to the SPIFFE policy only', () => {
    expect(spiffe.context.contextRef.id).toBe('aiDemoSpiffeTePolicy');
  });

  it('emits the actor SPIFFE ID as client_id and act.sub', () => {
    expect(fulfil.client_id.value).toBe('spiffeId');
    expect(fulfil.act.source.type).toBe('EXPRESSION');
    expect(fulfil.act.value).toContain('"sub": #this.get("tepp.spiffeId")');
  });

  it('takes spiffeId from the actor token in the policy', () => {
    const policy = read('spiffe-te-policy.json');
    expect(policy.processorMappings[0].attributeContractFulfillment.spiffeId)
      .toEqual({ source: { type: 'ACTOR_TOKEN' }, value: 'sub' });
  });

  it('leaves the Step 9 mapping (other use case) on the subject client_id', () => {
    const step9 = read('pf-step9-atm-mapping.json').attributeContractFulfillment;
    expect(step9.client_id.value).toBe('client_id');
  });
});
