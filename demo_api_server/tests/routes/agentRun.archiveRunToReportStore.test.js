'use strict';

jest.mock('../../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));

const { __test } = require('../../routes/agentRun');
const reportStore = require('../../services/lmdb/reportStore.lmdb');

const { _archiveRunToReportStore, _traceStore } = __test;

beforeEach(() => {
  reportStore.saveRun.mockClear();
  _traceStore.clear();
});

describe('agentRun._archiveRunToReportStore', () => {
  it('does nothing for a guest run (no userId)', () => {
    _traceStore.set('run_1', { events: [], startedAt: Date.now(), framework: 'langchain' });
    _archiveRunToReportStore('run_1', null, 'prompt', 'banking', []);
    expect(reportStore.saveRun).not.toHaveBeenCalled();
  });

  it('does nothing when the run was never recorded in _traceStore', () => {
    _archiveRunToReportStore('run_missing', 'user-1', 'prompt', 'banking', []);
    expect(reportStore.saveRun).not.toHaveBeenCalled();
  });

  it('archives a successful run with the tool names and token events it saw', () => {
    _traceStore.set('run_1', {
      startedAt: Date.now(),
      framework: 'langchain',
      events: [
        { type: 'RUN_STARTED', threadId: 't1' },
        { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'get_account_balance' },
        { type: 'TOOL_CALL_END', toolCallId: 'c1' },
        { type: 'RUN_FINISHED', outcome: {} },
      ],
    });

    _archiveRunToReportStore('run_1', 'user-1', 'check my balance', 'banking', [{ id: 'user-token' }]);

    expect(reportStore.saveRun).toHaveBeenCalledTimes(1);
    const record = reportStore.saveRun.mock.calls[0][0];
    expect(record.runId).toBe('run_1');
    expect(record.userId).toBe('user-1');
    expect(record.vertical).toBe('banking');
    expect(record.prompt).toBe('check my balance');
    expect(record.agentPath).toBe('agui');
    expect(record.toolsCalled).toEqual(['get_account_balance']);
    expect(record.tokenEvents).toEqual([{ id: 'user-token' }]);
    expect(record.tokenCount).toBe(1);
    expect(record.success).toBe(true);
  });

  it('marks success:false when the run recorded a RUN_ERROR', () => {
    _traceStore.set('run_2', {
      startedAt: Date.now(),
      framework: 'langchain',
      events: [
        { type: 'RUN_STARTED' },
        { type: 'RUN_ERROR', message: 'agent crashed' },
      ],
    });

    _archiveRunToReportStore('run_2', 'user-1', 'do something', 'banking', []);

    expect(reportStore.saveRun.mock.calls[0][0].success).toBe(false);
  });

  it('a reportStore failure does not throw', () => {
    reportStore.saveRun.mockImplementationOnce(() => { throw new Error('lmdb down'); });
    _traceStore.set('run_1', { startedAt: Date.now(), framework: 'langchain', events: [] });
    expect(() => _archiveRunToReportStore('run_1', 'user-1', 'x', 'banking', [])).not.toThrow();
  });
});
