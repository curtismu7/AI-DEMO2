module.exports = [
  { id: 'gov1', label: 'My benefits', message: 'show my benefits', mode: 'both', tool: 'list_benefits', useCaseId: 'view_benefits' },
  { id: 'gov2', label: 'Apply for benefit', message: 'apply for a benefit', mode: 'both', tool: 'apply_benefit', useCaseId: 'apply_benefit' },
  { id: 'gov3', label: 'Upload document', message: 'upload a document', mode: 'both', tool: 'upload_document', useCaseId: 'submit_document' },
  { id: 'gov4', label: 'Check status', message: 'check application status', mode: 'both', tool: 'check_status', useCaseId: 'view_status' },
  { id: 'gov-direct', label: 'Direct MCP', message: 'list my benefits', mode: 'direct', tool: 'list_benefits', useCaseId: 'view_benefits_direct' },
];
