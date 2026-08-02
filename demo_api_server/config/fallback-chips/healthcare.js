// Tools and useCaseIds copied from config/verticals/healthcare/manifest.json
// (dashboard.chips10) — never from another vertical's manifest.
module.exports = [
  { id: 'hc1', label: 'My records', message: 'my records', mode: 'both', tool: 'view_records', useCaseId: 'delegated-access-with-proof' },
  { id: 'hc2', label: 'Check coverage', message: 'check my coverage', mode: 'both', tool: 'view_coverage', useCaseId: 'delegated-access-with-proof' },
  { id: 'hc3', label: 'My appointments', message: 'my appointments', mode: 'both', tool: 'list_appointments', useCaseId: 'delegated-access-with-proof' },
  { id: 'hc4', label: 'Book an appointment', message: 'book an appointment', mode: 'both', tool: 'book_appointment', useCaseId: 'delegated-access-with-proof' },
  { id: 'hc5', label: 'Release my records', message: 'release my records', mode: 'both', tool: 'release_records', useCaseId: 'step-up-required' },
  { id: 'hc-direct', label: 'Direct MCP', message: 'list my records', mode: 'direct', tool: 'view_records', useCaseId: 'delegated-access-with-proof' },
];
