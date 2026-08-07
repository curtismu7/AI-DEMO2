'use strict';

describe('needsParams choices extraction', () => {
  it('includes enum choices for missing params that have an enum', () => {
    const toolDef = {
      name: 'test_action',
      inputSchema: {
        type: 'object',
        required: ['category'],
        properties: {
          category: {
            type: 'string',
            enum: ['Alpha', 'Beta', 'Gamma'],
          },
        },
      },
    };
    const params = {};
    const required = toolDef.inputSchema.required || [];
    const missing = required.filter((k) => params[k] == null || params[k] === '');

    const choices = {};
    missing.forEach((k) => {
      const prop = toolDef.inputSchema.properties && toolDef.inputSchema.properties[k];
      if (prop && Array.isArray(prop.enum)) {
        choices[k] = prop.enum;
      }
    });

    expect(missing).toEqual(['category']);
    expect(choices).toEqual({ category: ['Alpha', 'Beta', 'Gamma'] });
  });

  it('produces empty choices object when no enum defined', () => {
    const toolDef = {
      name: 'order_status',
      inputSchema: {
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string' } },
      },
    };
    const params = {};
    const missing = ['orderId'];
    const choices = {};
    missing.forEach((k) => {
      const prop = toolDef.inputSchema.properties && toolDef.inputSchema.properties[k];
      if (prop && Array.isArray(prop.enum)) choices[k] = prop.enum;
    });
    expect(choices).toEqual({});
  });
});
