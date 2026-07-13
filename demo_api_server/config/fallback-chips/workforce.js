module.exports = [
  { id: 'wf1', label: 'My schedule', message: 'show my schedule', mode: 'both', tool: 'get_schedule', useCaseId: 'view_schedule' },
  { id: 'wf2', label: 'Request time off', message: 'request time off', mode: 'both', tool: 'request_timeoff', useCaseId: 'request_timeoff' },
  { id: 'wf3', label: 'My paycheck', message: 'show my paycheck', mode: 'both', tool: 'get_paycheck', useCaseId: 'view_paycheck' },
  { id: 'wf4', label: 'Directory', message: 'find a coworker', mode: 'both', tool: 'search_directory', useCaseId: 'search_employees' },
  { id: 'wf-direct', label: 'Direct MCP', message: 'show my schedule', mode: 'direct', tool: 'get_schedule', useCaseId: 'view_schedule_direct' },
];
