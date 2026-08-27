'use strict';

/** Workforce tools — own HR actions (incl. novel submit_expense/request_time_off). */
function buildWorkforceTools(store) {
  const tools = [
    /* PACK:defs:start */
    { name: 'cancel_expense', description: "Cancel a pending expense report by expenseId.", inputSchema: { type: 'object', properties: { expenseId: { type: 'string' } }, required: ['expenseId'] }, scopes: ['write'], authz: {} },
    { name: 'enroll_training', description: "Enroll the employee in a training course by trainingId.", inputSchema: { type: 'object', properties: { trainingId: { type: 'string' } }, required: ['trainingId'] }, scopes: ['write'], authz: {} },
    { name: 'close_ticket', description: "Close an open support ticket by ticketId.", inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] }, scopes: ['write'], authz: {} },
    { name: 'complete_goal', description: "Mark a performance goal as completed by goalId.", inputSchema: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] }, scopes: ['write'], authz: {} },
    { name: 'request_schedule_change', description: "Request a change to a specific scheduled shift by scheduleId.", inputSchema: { type: 'object', properties: { scheduleId: { type: 'string' } }, required: [] }, scopes: ['write'], authz: {} },
    { name: 'update_goal_progress', description: "Update the progress status of a performance goal by goalId.", inputSchema: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] }, scopes: ['write'], authz: {} },
    { name: 'withdraw_training_enrollment', description: "Withdraw the employee from an enrolled training course by trainingId.", inputSchema: { type: 'object', properties: { trainingId: { type: 'string' } }, required: ['trainingId'] }, scopes: ['write'], authz: {} },
    { name: 'view_payslips', description: "List the employee's recent payslips.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_trainings', description: "List available and enrolled training courses for the employee.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_tickets', description: "List the employee's open and recent support tickets.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_schedule', description: "View the employee's upcoming work schedule and shifts.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_goals', description: "List the employee's performance goals and their current status.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_colleagues', description: "List the employee's teammates and direct colleagues in the org chart.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_payslip_detail', description: "View detailed breakdown of a specific payslip by pay period or payslip id.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_policies', description: "List company HR and workplace policies available to the employee.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_announcements', description: "List recent company announcements and news for the employee.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_direct_deposit', description: "View the employee's direct deposit and banking details on file.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    /* PACK:defs:end */
    {
      name: 'view_benefits',
      description: 'List the employee\'s benefits enrollments.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'pto_balance',
      description: 'Show the employee\'s PTO and sick leave balance.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'list_expenses',
      description: 'List the employee\'s expense reports.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'submit_expense',
      description: 'Submit an expense report. Requires step-up + confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          amount: { type: 'number' },
        },
        required: [],
      },
      scopes: ['write'],
      // consent only, matching retail `checkout` and every other UC6/7/8 amount
      // tool. Declaring stepUp too made gen-vertical-tools derive
      // challengeType 'step_up' (stepUp wins), so the live MCP policy answered
      // step-up for UC8's $300 where the catalog expects HITL — a Mismatch.
      // The obligation is amount-independent there, so UC7's $600 step-up comes
      // from the use-case catalog's declared stepUpMethod re-labelling the HITL,
      // exactly as it does for create_transfer and checkout.
      authz: { consent: true },
    },
    {
      name: 'request_time_off',
      description: 'Request time off. Requires confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number' },
        },
        required: [],
      },
      scopes: ['write'],
      authz: { consent: true },
    },
    {
      name: 'sensitive_payroll_details',
      description: 'Access sensitive payroll information including salary and banking details. Requires explicit user consent.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: { consent: true },
    },
    {
      name: 'api_key_demo',
      description: 'Demo API-key path.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'dual_token_demo',
      description: 'Demo access and ID token path.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      scopes: ['read'],
      authz: {},
    },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';

    switch (name) {
      /* PACK:cases:start */
      case 'cancel_expense': {
        const _id = params && (params.expenseId || params.recordId);
        const _arr = store.get(userId).expenses || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'expense not found' }, render: 'text' };
        Object.assign(_item, { status: 'Cancelled' });
        return { result: _item, render: 'cancel_expense' };
      }
      case 'enroll_training': {
        const _id = params && (params.trainingId || params.recordId);
        const _arr = store.get(userId).trainings || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'training not found' }, render: 'text' };
        Object.assign(_item, { status: 'Enrolled' });
        return { result: _item, render: 'enroll_training' };
      }
      case 'close_ticket': {
        const _id = params && (params.ticketId || params.recordId);
        const _arr = store.get(userId).tickets || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'ticket not found' }, render: 'text' };
        Object.assign(_item, { status: 'Closed' });
        return { result: _item, render: 'close_ticket' };
      }
      case 'complete_goal': {
        const _id = params && (params.goalId || params.recordId);
        const _arr = store.get(userId).goals || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'goal not found' }, render: 'text' };
        Object.assign(_item, { status: 'Completed' });
        return { result: _item, render: 'complete_goal' };
      }
      case 'request_schedule_change': {
        const _id = params && (params.scheduleId || params.recordId);
        const _arr = store.get(userId).schedules || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        // UC28's one-click chip carries no id — default to the member's first
        // record so the request-only boundary is demonstrated instead of
        // dead-ending on "I need: Id". Explicit-id callers are unaffected.
        if (!_item && !_id) _item = _arr[0];
        if (!_item) return { result: { error: 'schedule not found' }, render: 'text' };
        Object.assign(_item, { status: 'Change Requested' });
        return { result: _item, render: 'request_schedule_change' };
      }
      case 'update_goal_progress': {
        const _id = params && (params.goalId || params.recordId);
        const _arr = store.get(userId).goals || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'goal not found' }, render: 'text' };
        Object.assign(_item, { status: 'In Progress' });
        return { result: _item, render: 'update_goal_progress' };
      }
      case 'withdraw_training_enrollment': {
        const _id = params && (params.trainingId || params.recordId);
        const _arr = store.get(userId).trainings || [];
        let _item = _arr.find((r) => r.id === _id);
        if (!_item) { const _d = String(_id || '').replace(/\D/g, ''); if (_d) { const _m = _arr.filter((r) => String(r.id).replace(/\D/g, '') === _d); if (_m.length === 1) _item = _m[0]; } }
        if (!_item) return { result: { error: 'training not found' }, render: 'text' };
        Object.assign(_item, { status: 'Withdrawn' });
        return { result: _item, render: 'withdraw_training_enrollment' };
      }
      case 'view_payslips':
        return { result: { payslips: store.get(userId).payslips }, render: 'view_payslips' };
      case 'view_trainings':
        return { result: { trainings: store.get(userId).trainings }, render: 'view_trainings' };
      case 'view_tickets':
        return { result: { tickets: store.get(userId).tickets }, render: 'view_tickets' };
      case 'view_schedule':
        return { result: { schedules: store.get(userId).schedules }, render: 'view_schedule' };
      case 'view_goals':
        return { result: { goals: store.get(userId).goals }, render: 'view_goals' };
      case 'view_colleagues':
        return { result: { colleagues: store.get(userId).colleagues }, render: 'view_colleagues' };
      case 'view_payslip_detail':
        return { result: { payslips: store.get(userId).payslips }, render: 'view_payslip_detail' };
      case 'view_policies':
        return { result: { policies: store.get(userId).policies }, render: 'view_policies' };
      case 'view_announcements':
        return { result: { policies: store.get(userId).policies }, render: 'view_announcements' };
      case 'view_direct_deposit':
        return { result: { payslips: store.get(userId).payslips }, render: 'view_direct_deposit' };
      /* PACK:cases:end */
      case 'view_benefits':
        return {
          result: { benefits: store.get(userId).benefits },
          render: 'view_benefits',
        };

      case 'pto_balance':
        return {
          result: store.get(userId).pto,
          render: 'pto_balance',
        };

      case 'list_expenses':
        return {
          result: { expenses: store.get(userId).expenses },
          render: 'list_expenses',
        };

      case 'submit_expense': {
        // Amount-driven policy chip ("submit a $300 expense") may omit a category — default it
        // so the Authorize outcome (amount-driven) can still be demonstrated. A consent/step-up
        // showcase chip may omit the amount too — default it so the control runs against a real
        // expense. An amount-driven chip that DOES carry an amount keeps it (UC6/7/8 behavior).
        const _p = params || {};
        const _category = (_p.category && String(_p.category).trim()) ? _p.category : 'Travel';
        const _amount = _p.amount != null ? _p.amount : 100;
        return { result: store.submitExpense(userId, { ..._p, category: _category, amount: _amount }), render: 'submit_expense' };
      }

      case 'request_time_off': {
        // Consent showcase / one-click chips carry no day count — default to a single day
        // so the consent control runs instead of dead-ending on a missing-param prompt.
        const _p = params || {};
        const _days = _p.days != null ? _p.days : 1;
        const out = store.requestTimeOff(userId, { ..._p, days: _days });
        if (out && out.error) {
          return { result: { error: out.error }, render: 'text' };
        }
        return { result: out, render: 'request_time_off' };
      }

      case 'sensitive_payroll_details':
        return {
          result: {
            data: {
              baseSalary: '[REDACTED]',
              lastPayslipDate: '2025-12-31',
              bankAccountLast4: '****',
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

module.exports = { buildWorkforceTools };
