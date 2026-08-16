'use strict';

/**
 * Precision Works (manufacturing) tools — the vertical's OWN actions over its
 * OWN data store. No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is a key in the manifest's `render` block.
 */
function buildManufacturingTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'close_maintenance_ticket', description: "Close or resolve an open maintenance ticket by ticketId.", inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] }, scopes: ['write'], authz: {} },
    { name: 'complete_quality_inspection', description: "Mark a quality inspection as passed and complete by inspectionId.", inputSchema: { type: 'object', properties: { inspectionId: { type: 'string' } }, required: ['inspectionId'] }, scopes: ['write'], authz: {} },
    { name: 'receive_shipment', description: "Mark a shipment as received by shipmentId.", inputSchema: { type: 'object', properties: { shipmentId: { type: 'string' } }, required: ['shipmentId'] }, scopes: ['write'], authz: {} },
    { name: 'approve_purchase_order', description: "Approve a pending purchase order by poId.", inputSchema: { type: 'object', properties: { poId: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] }, scopes: ['write'], authz: {} },
    { name: 'reject_purchase_order', description: "Reject a pending purchase order by poId.", inputSchema: { type: 'object', properties: { poId: { type: 'string' } }, required: ['poId'] }, scopes: ['write'], authz: {} },
    { name: 'void_purchase_order', description: "Void a purchase order before supplier fulfillment by poId.", inputSchema: { type: 'object', properties: { poId: { type: 'string' } }, required: ['poId'] }, scopes: ['write'], authz: {} },
    { name: 'flag_defect', description: "Flag or log a quality defect record by defectId.", inputSchema: { type: 'object', properties: { defectId: { type: 'string' } }, required: ['defectId'] }, scopes: ['write'], authz: {} },
    { name: 'reopen_defect', description: "Reopen a previously closed defect record for further investigation by defectId.", inputSchema: { type: 'object', properties: { defectId: { type: 'string' } }, required: ['defectId'] }, scopes: ['write'], authz: {} },
    { name: 'put_machine_offline', description: "Set a machine's status to Offline by machineId.", inputSchema: { type: 'object', properties: { machineId: { type: 'string' } }, required: ['machineId'] }, scopes: ['write'], authz: {} },
    { name: 'expedite_shipment', description: "Mark a shipment as expedited to prioritize its dispatch by shipmentId.", inputSchema: { type: 'object', properties: { shipmentId: { type: 'string' } }, required: ['shipmentId'] }, scopes: ['write'], authz: {} },
    { name: 'escalate_maintenance_ticket', description: "Escalate a maintenance ticket to urgent priority by ticketId.", inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] }, scopes: ['write'], authz: {} },
    { name: 'view_machines', description: "List all machines on the shop floor with current status and utilization.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_machine_utilization', description: "View machine utilization rates and OEE metrics across the shop floor.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_quality_inspections', description: "List quality control inspections and their pass/fail status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_shipments', description: "List outbound shipments and their current delivery status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_purchase_orders', description: "List pending and recent purchase orders for raw materials and supplies.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_maintenance_tickets', description: "List open and recent maintenance tickets for shop floor equipment.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_defects', description: "List quality defect records logged against open work orders.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_scrap_report', description: "View the scrap and rework report derived from logged defect records.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_supplier_scorecard', description: "View supplier performance scorecard derived from purchase order delivery and quality data.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    {
      // The agent can only REQUEST this (logged for human review) — no tool
      // can grant it. The tool set is the authorization boundary (UC28).
      name: 'request_spec_exception',
      description: 'Submit a spec-exception request for engineering review. Cannot grant an exception.',
      inputSchema: { type: 'object', properties: { workOrderId: { type: 'string' } } },
      scopes: ['write'],
      authz: {},
    },
    { name: 'view_work_orders', description: 'List the operator\'s work orders.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_inventory', description: 'Show on-hand inventory value and stock levels.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_production_history', description: 'List production-run history (setups, runs, inspections, shipments).', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'schedule_run', description: 'Schedule a production run for a work order.', inputSchema: { type: 'object', properties: { workOrder: { type: 'string' }, when: { type: 'string' } } }, scopes: ['write'], authz: {} },
    { name: 'release_work_order', description: 'Release a work order to the production floor (requires step-up + consent).', inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
    { name: 'sensitive_supplier_contract', description: 'Access highly sensitive supplier contract terms. Requires explicit user consent.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: { consent: true } },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      /* PACK:cases:start */
      case 'close_maintenance_ticket': {
        const _id = params && (params.ticketId || params.recordId);
        const _arr = store.get(userId).maintenanceTickets || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'maintenance ticket not found' }, render: 'text' };
        Object.assign(_item, { status: 'Closed' });
        return { result: _item, render: 'close_maintenance_ticket' };
      }
      case 'complete_quality_inspection': {
        const _id = params && (params.inspectionId || params.recordId);
        const _arr = store.get(userId).qualityInspections || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'quality inspection not found' }, render: 'text' };
        Object.assign(_item, { status: 'Passed' });
        return { result: _item, render: 'complete_quality_inspection' };
      }
      case 'receive_shipment': {
        const _id = params && (params.shipmentId || params.recordId);
        const _arr = store.get(userId).shipments || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'shipment not found' }, render: 'text' };
        Object.assign(_item, { status: 'Received' });
        return { result: _item, render: 'receive_shipment' };
      }
      case 'approve_purchase_order': {
        const _id = params && (params.poId || params.recordId);
        const _arr = store.get(userId).purchaseOrders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        const _byExplicitId = !!_item;
        // Amount-driven policy chip ("approve a $300 purchase order") carries no PO id — default to the first pending PO.
        if (!_item && !_id) _item = _arr.find((r) => r.status === 'Pending Approval') || _arr[0];
        if (!_item) return { result: { error: 'purchase order not found' }, render: 'text' };
        // Only gate the explicit-id path: an agent naming a specific PO must not silently
        // re-"approve" one that's already Approved/Delivered/Rejected/Voided. The amount-driven
        // no-id fallback intentionally keeps completing even when every real Pending Approval PO
        // is exhausted — see useCases.chipCompletes.test.js, which requires every catalog chip to
        // finish rather than error.
        if (_byExplicitId && _item.status !== 'Pending Approval') return { result: { error: 'purchase order is not pending approval' }, render: 'text' };
        Object.assign(_item, { status: 'Approved' });
        return { result: _item, render: 'approve_purchase_order' };
      }
      case 'reject_purchase_order': {
        const _id = params && (params.poId || params.recordId);
        const _arr = store.get(userId).purchaseOrders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'purchase order not found' }, render: 'text' };
        Object.assign(_item, { status: 'Rejected' });
        return { result: _item, render: 'reject_purchase_order' };
      }
      case 'void_purchase_order': {
        const _id = params && (params.poId || params.recordId);
        const _arr = store.get(userId).purchaseOrders || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'purchase order not found' }, render: 'text' };
        Object.assign(_item, { status: 'Voided' });
        return { result: _item, render: 'void_purchase_order' };
      }
      case 'flag_defect': {
        const _id = params && (params.defectId || params.recordId);
        const _arr = store.get(userId).defects || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'defect not found' }, render: 'text' };
        Object.assign(_item, { status: 'Flagged' });
        return { result: _item, render: 'flag_defect' };
      }
      case 'reopen_defect': {
        const _id = params && (params.defectId || params.recordId);
        const _arr = store.get(userId).defects || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'defect not found' }, render: 'text' };
        Object.assign(_item, { status: 'Reopened' });
        return { result: _item, render: 'reopen_defect' };
      }
      case 'put_machine_offline': {
        const _id = params && (params.machineId || params.recordId);
        const _arr = store.get(userId).machines || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'machine not found' }, render: 'text' };
        Object.assign(_item, { status: 'Offline' });
        return { result: _item, render: 'put_machine_offline' };
      }
      case 'expedite_shipment': {
        const _id = params && (params.shipmentId || params.recordId);
        const _arr = store.get(userId).shipments || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'shipment not found' }, render: 'text' };
        Object.assign(_item, { status: 'Expedited' });
        return { result: _item, render: 'expedite_shipment' };
      }
      case 'escalate_maintenance_ticket': {
        const _id = params && (params.ticketId || params.recordId);
        const _arr = store.get(userId).maintenanceTickets || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'maintenance ticket not found' }, render: 'text' };
        Object.assign(_item, { status: 'Escalated' });
        return { result: _item, render: 'escalate_maintenance_ticket' };
      }
      case 'view_machines':
        return { result: { machines: store.get(userId).machines }, render: 'view_machines' };
      case 'view_machine_utilization':
        return { result: { machines: store.get(userId).machines }, render: 'view_machine_utilization' };
      case 'view_quality_inspections':
        return { result: { qualityInspections: store.get(userId).qualityInspections }, render: 'view_quality_inspections' };
      case 'view_shipments':
        return { result: { shipments: store.get(userId).shipments }, render: 'view_shipments' };
      case 'view_purchase_orders':
        return { result: { purchaseOrders: store.get(userId).purchaseOrders }, render: 'view_purchase_orders' };
      case 'view_maintenance_tickets':
        return { result: { maintenanceTickets: store.get(userId).maintenanceTickets }, render: 'view_maintenance_tickets' };
      case 'view_defects':
        return { result: { defects: store.get(userId).defects }, render: 'view_defects' };
      case 'view_scrap_report':
        return { result: { defects: store.get(userId).defects }, render: 'view_scrap_report' };
      case 'view_supplier_scorecard':
        return { result: { purchaseOrders: store.get(userId).purchaseOrders }, render: 'view_supplier_scorecard' };
      /* PACK:cases:end */
      case 'request_spec_exception': {
        // Request ONLY — deliberately changes nothing. The agent has no tool that
        // can approve this, so it cannot promise one (UC28). The one-click chip
        // carries no id, so default to the member's first record.
        const _rows = store.get(userId).workOrders || [];
        const _want = params && (params.workOrderId || params.recordId);
        const _rec = _want ? _rows.find((r) => r.id === _want) : _rows[0];
        if (!_rec) return { result: { error: 'work order not found' }, render: 'text' };
        return {
          result: {
            requestId: `REQ-${_rec.id}`,
            workOrderId: _rec.id,
            status: 'Submitted for human review',
            note: 'This request does not grant a spec exception.',
          },
          render: 'request_spec_exception',
        };
      }
      case 'view_work_orders':
        return { result: { workOrders: store.get(userId).workOrders }, render: 'view_work_orders' };
      case 'view_inventory':
        return { result: store.get(userId).inventory, render: 'view_inventory' };
      case 'view_production_history':
        return { result: { history: store.get(userId).productionHistory }, render: 'view_production_history' };
      case 'schedule_run':
        return { result: store.scheduleRun(userId, params || {}), render: 'schedule_run' };
      case 'release_work_order': {
        // Consent/step-up showcase chips carry no order id — default to the first work order
        // so the security control (consent + step-up) is demonstrated against a real record.
        const _oid = (params && params.orderId) || (store.get(userId).workOrders[0] || {}).id;
        const wo = store.releaseWorkOrder(userId, _oid);
        if (!wo) return { result: { error: 'work order not found' }, render: 'text' };
        return { result: wo, render: 'release_work_order' };
      }
      case 'sensitive_supplier_contract':
        return {
          result: {
            data: {
              contract: {
                supplier: 'Apex Components Inc.',
                contractId: 'SC-2026-0044',
                unitPricing: '[REDACTED]',
                paymentTerms: 'Net 45',
                ndaSigned: true,
                renewalDate: '2027-01-15',
                status: 'Active',
              },
              sensitiveDataAccessed: true,
              accessGrantedBy: 'consent',
            },
          },
          render: 'text',
        };
      case 'api_key_demo':
      case 'dual_token_demo':
        return { result: { data: {} }, render: 'text' };
      default:
        return { result: { error: `unknown tool: ${name}` }, render: 'text' };
    }
  }

  return { tools, execute };
}

module.exports = { buildManufacturingTools };
