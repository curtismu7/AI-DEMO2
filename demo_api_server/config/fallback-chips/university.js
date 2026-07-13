module.exports = [
  { id: 'uni1', label: 'My grades', message: 'show my grades', mode: 'both', tool: 'get_grades', useCaseId: 'view_grades' },
  { id: 'uni2', label: 'My courses', message: 'show my courses', mode: 'both', tool: 'list_courses', useCaseId: 'view_courses' },
  { id: 'uni3', label: 'Course schedule', message: 'show my schedule', mode: 'both', tool: 'get_schedule', useCaseId: 'view_schedule' },
  { id: 'uni4', label: 'Tuition balance', message: 'what is my tuition balance', mode: 'both', tool: 'get_balance', useCaseId: 'view_balance' },
  { id: 'uni-direct', label: 'Direct MCP', message: 'show my grades', mode: 'direct', tool: 'get_grades', useCaseId: 'view_grades_direct' },
];
