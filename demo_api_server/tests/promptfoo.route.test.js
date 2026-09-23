'use strict';

const request = require('supertest');
const express = require('express');
const fs = require('fs');

jest.mock('child_process', () => ({ execFile: jest.fn() }));

const { execFile } = require('child_process');
const router = require('../routes/promptfoo');

const app = express();
app.use(express.json());
app.use('/api/admin/promptfoo', router);

describe('POST /api/admin/promptfoo/run', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('returns the child process stderr when an eval fails', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(Object.assign(new Error('Command failed: npx promptfoo eval'), { code: 1 }), '', 'Promptfoo assertion failed: expected non-empty reply\n');
    });

    const response = await request(app)
      .post('/api/admin/promptfoo/run')
      .send({ suite: 'agent-eval' })
      .expect(200);

    expect(response.body.stderr).toBe('Promptfoo assertion failed: expected non-empty reply\n');
  });
});
