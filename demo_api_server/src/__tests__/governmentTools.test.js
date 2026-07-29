'use strict';

const { createGovernmentStore } = require('../../config/verticals/government/data');
const { buildGovernmentTools } = require('../../config/verticals/government/tools');

describe('government tools', () => {
  let store; let execute;
  beforeEach(() => {
    store = createGovernmentStore();
    ({ execute } = buildGovernmentTools(store));
  });

  it('cancel_appointment accepts appointmentId (regression: handler previously only read id/recordId)', async () => {
    const apptId = store.get('u').appointments[0].id;
    const out = await execute('cancel_appointment', { appointmentId: apptId }, { userId: 'u' });
    expect(out.result.status).toBe('Cancelled');
    expect(out.render).toBe('cancel_appointment');
  });
});
