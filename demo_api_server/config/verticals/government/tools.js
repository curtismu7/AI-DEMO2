'use strict';

/**
 * CivicPermit (government) tools — the vertical's OWN actions over its OWN
 * data store. No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildGovernmentTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'dispute_violation', description: "Dispute or appeal a code violation by ID, setting its status to Disputed.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'reschedule_gov_appointment', description: "Request to reschedule a city appointment by ID.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_permit', description: "Cancel an active permit by ID, setting its status to Cancelled.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'submit_filing', description: "Submit a pending filing by ID, updating its status to Submitted.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'approve_inspection', description: "Approve/pass an inspection record by ID, setting its status to Passed.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'close_violation', description: "Close an open code violation by ID, setting its status to Closed.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'schedule_inspection', description: "Schedule a pending inspection by ID, setting its status to Scheduled.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'renew_permit', description: "Renew a permit by ID, setting its status to Renewal Submitted.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'cancel_appointment', description: "Cancel a scheduled appointment by ID, setting its status to Cancelled.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, scopes: ['write'], authz: {} },
    { name: 'view_inspections', description: "List all inspections associated with the user's permits.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_violations', description: "List code violation cases associated with addresses on the user's account.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_business_licenses', description: "List business licenses registered to the user or their associated businesses.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_appointments', description: "List upcoming and past appointments booked with city offices.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_tax_assessments', description: "List property tax assessments and payment status for parcels associated with the user.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_records_requests', description: "List public records and FOIA requests submitted by the user.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_complaints', description: "List service complaints and reported issues submitted by the user.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_documents', description: "List official documents and certificates available for download on the user's account.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_payment_history', description: "View the history of payments made on the user's account.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_zoning_info', description: "View zoning classifications and overlay districts for properties associated with the user.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_notifications', description: "View account notifications including reminders, alerts, and status updates from city offices.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    { name: 'view_permits', description: 'List the resident\'s permits and licenses.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_fees', description: 'Show the resident\'s outstanding permit fees.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_filings', description: 'List the resident\'s filing history (applications, inspections, renewals).', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'pay_fee', description: 'Pay an outstanding permit fee.', inputSchema: { type: 'object', properties: { amount: { type: 'number' }, permitId: { type: 'string' } } }, scopes: ['write'], authz: {} },
    { name: 'release_record', description: 'Release a permit record to a third party (requires step-up + consent).', inputSchema: { type: 'object', properties: { permitId: { type: 'string' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
    { name: 'sensitive_tax_record', description: 'Access highly sensitive tax assessment records. Requires explicit user consent.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: { consent: true } },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      /* PACK:cases:start */
      case 'dispute_violation': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).violations || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'violation not found' }, render: 'text' };
        Object.assign(_item, { status: 'Disputed' });
        return { result: _item, render: 'dispute_violation' };
      }
      case 'reschedule_gov_appointment': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).appointments || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'appointment not found' }, render: 'text' };
        Object.assign(_item, { status: 'Reschedule Requested' });
        return { result: _item, render: 'reschedule_gov_appointment' };
      }
      case 'cancel_permit': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).permits || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'permit not found' }, render: 'text' };
        Object.assign(_item, { status: 'Cancelled' });
        return { result: _item, render: 'cancel_permit' };
      }
      case 'submit_filing': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).filings || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'filing not found' }, render: 'text' };
        Object.assign(_item, { status: 'Submitted' });
        return { result: _item, render: 'submit_filing' };
      }
      case 'approve_inspection': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).inspections || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'inspection not found' }, render: 'text' };
        Object.assign(_item, { status: 'Passed' });
        return { result: _item, render: 'approve_inspection' };
      }
      case 'close_violation': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).violations || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'violation not found' }, render: 'text' };
        Object.assign(_item, { status: 'Closed' });
        return { result: _item, render: 'close_violation' };
      }
      case 'schedule_inspection': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).inspections || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'inspection not found' }, render: 'text' };
        Object.assign(_item, { status: 'Scheduled' });
        return { result: _item, render: 'schedule_inspection' };
      }
      case 'renew_permit': {
        const _id = params && (params.id || params.recordId);
        const _arr = store.get(userId).permits || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'permit not found' }, render: 'text' };
        Object.assign(_item, { status: 'Renewal Submitted' });
        return { result: _item, render: 'renew_permit' };
      }
      case 'cancel_appointment': {
        const _id = params && (params.id || params.recordId || params.appointmentId);
        const _arr = store.get(userId).appointments || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'appointment not found' }, render: 'text' };
        Object.assign(_item, { status: 'Cancelled' });
        return { result: _item, render: 'cancel_appointment' };
      }
      case 'view_inspections':
        return { result: { inspections: store.get(userId).inspections }, render: 'view_inspections' };
      case 'view_violations':
        return { result: { violations: store.get(userId).violations }, render: 'view_violations' };
      case 'view_business_licenses':
        return { result: { businessLicenses: store.get(userId).businessLicenses }, render: 'view_business_licenses' };
      case 'view_appointments':
        return { result: { appointments: store.get(userId).appointments }, render: 'view_appointments' };
      case 'view_tax_assessments':
        return { result: { taxAssessments: store.get(userId).taxAssessments }, render: 'view_tax_assessments' };
      case 'view_records_requests':
        return { result: { recordsRequests: store.get(userId).recordsRequests }, render: 'view_records_requests' };
      case 'view_complaints':
        return { result: { complaints: store.get(userId).complaints }, render: 'view_complaints' };
      case 'view_documents':
        return { result: { documents: store.get(userId).documents }, render: 'view_documents' };
      case 'view_payment_history':
        return { result: { payments: store.get(userId).payments }, render: 'view_payment_history' };
      case 'view_zoning_info':
        return { result: { zoningInfo: store.get(userId).zoningInfo }, render: 'view_zoning_info' };
      case 'view_notifications':
        return { result: { notifications: store.get(userId).notifications }, render: 'view_notifications' };
      /* PACK:cases:end */
      case 'view_permits':
        return { result: { permits: store.get(userId).permits }, render: 'view_permits' };
      case 'view_fees':
        return { result: store.get(userId).fees, render: 'view_fees' };
      case 'view_filings':
        return { result: { filings: store.get(userId).filings }, render: 'view_filings' };
      case 'pay_fee':
        return { result: store.payFee(userId, params || {}), render: 'pay_fee' };
      case 'release_record': {
        // Consent/step-up showcase chips carry no permit id — default to the first permit
        // so the security control (consent + step-up) is demonstrated against a real record.
        const _pid = (params && params.permitId) || (store.get(userId).permits[0] || {}).id;
        const permit = store.releaseRecord(userId, _pid);
        if (!permit) return { result: { error: 'permit not found' }, render: 'text' };
        return { result: permit, render: 'release_record' };
      }
      case 'sensitive_tax_record':
        return {
          result: {
            data: {
              record: {
                parcel: '17-22-401-001',
                owner: '[REDACTED]',
                address: '1234 Maple Street, Springfield, IL',
                taxYear: 2026,
                assessedValue: 224000,
                taxDue: 4480,
                status: 'Pending',
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

module.exports = { buildGovernmentTools };
