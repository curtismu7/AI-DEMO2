'use strict';
import { HEALTHCARE_TOOLS, dispatchHealthcareTool } from '../src/tools/healthcareTools';
import { GOVERNMENT_TOOLS, dispatchGovernmentTool } from '../src/tools/governmentTools';
import { MANUFACTURING_TOOLS, dispatchManufacturingTool } from '../src/tools/manufacturingTools';

// Re-usable conformance check
function checkToolConformance(tools: any[], scope: string) {
  expect(tools.length).toBe(2);
  for (const t of tools) {
    expect(typeof t.description).toBe('string');
    expect(t.description.length).toBeGreaterThan(10);
    expect(Array.isArray(t.intentHints)).toBe(true);
    expect(t.intentHints.length).toBeGreaterThanOrEqual(3);
    expect(t.requiredScopes).toContain(scope);
  }
}

describe('Healthcare tools', () => {
  // view_records deliberately requires only 'read' (matches scope-topology.json's
  // tools.view_records entry — the chip-facing tool this now backs); the
  // vertical-namespaced check doesn't apply to it.
  it('conforms to McpToolDef shape', () => {
    for (const t of HEALTHCARE_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints.length).toBeGreaterThanOrEqual(3);
    }
    expect(HEALTHCARE_TOOLS.find((t) => t.name === 'view_records')?.requiredScopes).toContain('read');
    expect(HEALTHCARE_TOOLS.find((t) => t.name === 'get_patient_record')?.requiredScopes).toContain('healthcare:read');
  });

  it('view_records returns patientRecords array, stamped for the chip-facing manifest descriptor', async () => {
    const result = await dispatchHealthcareTool('view_records', {}) as any;
    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records[0]).toHaveProperty('id');
    expect(result.render).toBe('view_records');
  });

  it('get_patient_record returns one record by id', async () => {
    const list = (await dispatchHealthcareTool('view_records', {}) as any).records;
    const id = list[0].id;
    const r = await dispatchHealthcareTool('get_patient_record', { record_id: id }) as any;
    expect(r.record.id).toBe(id);
  });
});

describe('Government tools', () => {
  it('conforms to McpToolDef shape', () => checkToolConformance(GOVERNMENT_TOOLS, 'government:read'));

  it('list_permits returns permits array', async () => {
    const result = await dispatchGovernmentTool('list_permits', {}) as any;
    expect(Array.isArray(result.permits)).toBe(true);
    expect(result.permits[0]).toHaveProperty('id');
  });

  it('get_permit returns one permit by id', async () => {
    const list = (await dispatchGovernmentTool('list_permits', {}) as any).permits;
    const id = list[0].id;
    const r = await dispatchGovernmentTool('get_permit', { permit_id: id }) as any;
    expect(r.permit.id).toBe(id);
  });
});

describe('Manufacturing tools', () => {
  it('conforms to McpToolDef shape', () => checkToolConformance(MANUFACTURING_TOOLS, 'manufacturing:read'));

  it('list_work_orders returns array (may be empty for demo data)', async () => {
    const result = await dispatchManufacturingTool('list_work_orders', {}) as any;
    expect(Array.isArray(result.workOrders)).toBe(true);
  });

  it('get_work_order returns not_found for unknown id', async () => {
    const r = await dispatchManufacturingTool('get_work_order', { order_id: 'no-such' }) as any;
    expect(r.found).toBe(false);
  });
});
