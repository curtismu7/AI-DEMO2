'use strict';

// GET /events is an idle SSE stream; without a periodic write the ingress/ALB
// cuts it (~60s) and the browser logs ERR_HTTP2_PROTOCOL_ERROR.

const { EventEmitter } = require('events');

test('GET /events writes a keepalive comment and stops on close', () => {
  jest.useFakeTimers();
  const router = require('../../routes/privilegeMcpClient');
  const handler = router.stack.find((l) => l.route?.path === '/events').route.stack[0].handle;
  const req = new EventEmitter();
  req.sessionID = 'keepalive-test';
  const res = { writeHead: jest.fn(), write: jest.fn() };

  handler(req, res);
  expect(res.writeHead.mock.calls[0][1]['X-Accel-Buffering']).toBe('no');
  res.write.mockClear();
  jest.advanceTimersByTime(25000);
  expect(res.write).toHaveBeenCalledWith(': keepalive\n\n');

  req.emit('close');
  res.write.mockClear();
  jest.advanceTimersByTime(60000);
  expect(res.write).not.toHaveBeenCalled();
  jest.useRealTimers();
});
