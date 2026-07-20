'use strict';

const { buildDecisionTask, buildCoordinatorTask, buildAuthorizationTask } = require('../../config/a2a/tasks');

describe('config/a2a/tasks', () => {
  test('buildDecisionTask embeds the message and the shouldDelegate/reason/sensitivity contract', () => {
    const task = buildDecisionTask({ role: 'Decision Maker' }, 'please delegate this');
    expect(task.description).toContain('please delegate this');
    expect(task.description).toContain('shouldDelegate');
    expect(task.description).toContain('sensitivity');
    expect(task.agent).toEqual({ role: 'Decision Maker' });
  });

  test('buildCoordinatorTask asks the model to pick one tool from the specialist\'s own list', () => {
    const tools = ['get_portfolio_summary', 'get_investment_accounts'];
    const task = buildCoordinatorTask({ role: 'Coordinator' }, 'banking', tools, 'show me my investment accounts');
    expect(task.description).toContain('show me my investment accounts');
    expect(task.description).toContain('get_portfolio_summary');
    expect(task.description).toContain('get_investment_accounts');
    expect(task.description).toContain('"tool"');
    expect(task.description).not.toContain('"scopes"');
  });

  test('buildAuthorizationTask reviews a specialist + tool pair, not a scopes list', () => {
    const task = buildAuthorizationTask({ role: 'Reviewer' }, 'Investment Advisor', 'get_portfolio_summary');
    expect(task.description).toContain('Investment Advisor');
    expect(task.description).toContain('get_portfolio_summary');
    expect(task.description).toContain('"approved"');
    expect(task.description).toContain('"blockers"');
  });
});
