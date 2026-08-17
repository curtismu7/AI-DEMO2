'use strict';
import { HEALTHCARE_TOOLS, dispatchHealthcareTool } from '../src/tools/healthcareTools';
import { GOVERNMENT_TOOLS, dispatchGovernmentTool } from '../src/tools/governmentTools';
import { MANUFACTURING_TOOLS, dispatchManufacturingTool } from '../src/tools/manufacturingTools';

describe('Healthcare tools', () => {
  // view_records deliberately requires only 'read' (matches scope-topology.json's
  // tools.view_records entry — the chip-facing tool this now backs); the
  // vertical-namespaced check doesn't apply to it.
  it('conforms to McpToolDef shape', () => {
    for (const t of HEALTHCARE_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
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
  it('conforms to McpToolDef shape', () => {
    for (const t of GOVERNMENT_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
    }
    expect(GOVERNMENT_TOOLS.find((t) => t.name === 'view_permits')?.requiredScopes).toContain('read');
    expect(GOVERNMENT_TOOLS.find((t) => t.name === 'get_permit')?.requiredScopes).toContain('government:read');
  });

  it('view_permits returns permits array, stamped for the chip-facing manifest descriptor', async () => {
    const result = await dispatchGovernmentTool('view_permits', {}) as any;
    expect(Array.isArray(result.permits)).toBe(true);
    expect(result.permits[0]).toHaveProperty('id');
    expect(result.render).toBe('view_permits');
  });

  it('get_permit returns one permit by id', async () => {
    const list = (await dispatchGovernmentTool('view_permits', {}) as any).permits;
    const id = list[0].id;
    const r = await dispatchGovernmentTool('get_permit', { permit_id: id }) as any;
    expect(r.permit.id).toBe(id);
  });
});

describe('Manufacturing tools', () => {
  it('conforms to McpToolDef shape', () => {
    for (const t of MANUFACTURING_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect(t.intentHints!.length).toBeGreaterThanOrEqual(3);
    }
    expect(MANUFACTURING_TOOLS.find((t) => t.name === 'view_work_orders')?.requiredScopes).toContain('read');
    expect(MANUFACTURING_TOOLS.find((t) => t.name === 'get_work_order')?.requiredScopes).toContain('manufacturing:read');
  });

  it('view_work_orders returns array, stamped for the chip-facing manifest descriptor', async () => {
    const result = await dispatchManufacturingTool('view_work_orders', {}) as any;
    expect(Array.isArray(result.workOrders)).toBe(true);
    expect(result.render).toBe('view_work_orders');
  });

  it('get_work_order returns not_found for unknown id', async () => {
    const r = await dispatchManufacturingTool('get_work_order', { order_id: 'no-such' }) as any;
    expect(r.found).toBe(false);
  });
});
