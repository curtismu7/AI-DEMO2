'use strict';

const { createVerticalPlugin } = require('../shared/createVerticalPlugin');
const { createManufacturingStore } = require('./data');
const { buildManufacturingTools } = require('./tools');

const store = createManufacturingStore();
const { tools, execute } = buildManufacturingTools(store);

const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\b(close|resolve|complete)\b.*\bmaintenance\b.*\bticket\b|\bmaintenance\b.*\bticket\b.*\b(clos\w*|resolv\w*|complet\w*)\b/i, action: 'close_maintenance_ticket', extractsRecordId: true },
  { re: /\b(complete|pass|sign[\s-]off)\b.*\b(quality|QC|QA)\b.*\binspection\b|\b(quality|QC|QA)\b.*\binspection\b.*\b(complet\w*|pass\w*|sign[\s-]?off)\b/i, action: 'complete_quality_inspection', extractsRecordId: true },
  { re: /\b(receive|confirm\s+receipt|accept)\b.*\bshipment\b|\bshipment\b.*\b(receiv\w*|confirm\w*)\b/i, action: 'receive_shipment', extractsRecordId: true },
  { re: /\bapprov\w*\b.*\b(purchase\s+order|po)\b|\b(purchase\s+order|po)\b.*\bapprov\w*\b/i, action: 'approve_purchase_order', extractsRecordId: true },
  { re: /\breject\b.*\b(purchase\s+order|po)\b|\b(purchase\s+order|po)\b.*\breject\b/i, action: 'reject_purchase_order', extractsRecordId: true },
  { re: /\bvoid\b.*\b(purchase\s+order|po)\b|\b(purchase\s+order|po)\b.*\bvoid\b/i, action: 'void_purchase_order', extractsRecordId: true },
  { re: /\b(flag|log|report)\b.*\bdefect\b|\bdefect\b.*\b(flagg\w*|logg\w*|report\w*)\b/i, action: 'flag_defect', extractsRecordId: true },
  { re: /\breopen\w*\b.*\bdefect\b|\bdefect\b.*\breopen\w*\b/i, action: 'reopen_defect', extractsRecordId: true },
  { re: /\b(take|put)\b.*\bmachine\b.*\b(off[\s-]?line|down|out\s+of\s+service)\b|\bmachine\b.*\b(off[\s-]?line|shut\s+down|take\s+down)\b/i, action: 'put_machine_offline', extractsRecordId: true },
  { re: /\b(expedite|rush|prioriti[sz]e)\w*\b.*\bshipment\b|\bshipment\b.*\b(expedit\w*|rush\w*|prioriti[sz]\w*)\b/i, action: 'expedite_shipment', extractsRecordId: true },
  { re: /\bescalat\w*\b.*\b(maintenance|ticket|mt[- ]?\d+)\b|\b(maintenance\s+ticket|mt[- ]?\d+)\b.*\bescalat\w*\b/i, action: 'escalate_maintenance_ticket', extractsRecordId: true },
  { re: /\bmachines?\s+(status|list|floor|center|log)\b|\bequipment\s+status\b|\bCNC\b|\blathes?\b|\bmills?\b/i, action: 'view_machines' },
  { re: /\bmachine\s+utilization\b|\butilization\s+(rate|report|metric)\w*\b|\boee\b|\bequipment\s+utilization\b/i, action: 'view_machine_utilization' },
  { re: /\b(quality|QC|QA)\s+(inspection[s]?|check[s]?|log[s]?)\b|\binspection[s]?\s+(queue|status|result[s]?|log[s]?)\b/i, action: 'view_quality_inspections' },
  { re: /\bshipments?\b|\boutbound\s+(orders?|freight|loads?)\b|\bshipping\s+(queue|log|status)\b/i, action: 'view_shipments' },
  { re: /\bpurchase\s+orders?\b|\bopen\s+POs?\b|\bmy\s+POs?\b/i, action: 'view_purchase_orders' },
  { re: /\bmaintenance\s+(ticket[s]?|log[s]?|request[s]?|queue)\b|\bopen\s+maintenance\b/i, action: 'view_maintenance_tickets' },
  { re: /\b(view|show|see|get|list|open|all|my)\b.*\bdefects?\b|\bdefects?\s+(log|list|queue|report)\b|\bdefect\s+log\b|^defects?$/i, action: 'view_defects' },
  { re: /\bscrap\s+(report|rate|log|summary)\b|\brework\s+(rate|report|log|summary)\b/i, action: 'view_scrap_report' },
  { re: /\bsupplier\s+(scorecard|rating|performance|score)\b|\bscorecard\b|\bperform\w*\b.*\bdeliver\w*\b|\bdeliver\w*\b.*\bperform\w*\b/i, action: 'view_supplier_scorecard' },
  /* PACK:heuristics:end */
  // Most specific first. release_work_order must precede view_work_orders; schedule_run must precede view_production_history.
  { re: /\b(release|authorize|ship)\s+(my\s+)?(work\s+)?order/i, action: 'release_work_order', extractsOrderId: true, paramHint: 'e.g. "release work order WO-4001" — check your work orders list for the ID' },
  { re: /\bschedule\b.*\b(run|production|job)\b|\bstart\s+(a\s+)?(production\s+)?run\b/i, action: 'schedule_run' },
  { re: /\b(inventory|stock|on[\s-]?hand|materials?)\b/i, action: 'view_inventory' },
  { re: /\bproduction\s+history\b|\bproduction\s+runs?\b|\boperations?\b|\brun\s+history\b/i, action: 'view_production_history' },
  { re: /\b(work\s+orders?|jobs?|orders?)\b/i, action: 'view_work_orders' },
  { re: /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|charge|spend|order|defect)|check for unusual|flag any unusual|spot unusual/i, action: 'view_work_orders' },
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'operator';
  return [
    'You are Precision Works\' Production Assistant (Gauge), a manufacturing shop-floor helper.',
    'You help operators view work orders and on-hand inventory, review production history,',
    'schedule production runs, and release work orders to the floor with the required consent',
    'and step-up verification.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed manufacturing actions; never reference financial or banking-account concepts.',
  ].join(' ');
}

module.exports = createVerticalPlugin({ id: 'manufacturing', store, tools, execute, heuristics: HEURISTICS, systemPrompt });
