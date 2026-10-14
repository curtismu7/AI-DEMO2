'use strict';
const hub = require('../../../services/oboEventHub');
const fakeRes = () => ({ write: jest.fn() });

beforeEach(() => hub._reset());

test('delivers to subscribers of the same sub only', () => {
  const a = fakeRes(); const b = fakeRes();
  hub.subscribe('u1', a); hub.subscribe('u2', b);
  hub.publish('u1', { n: 1 });
  expect(a.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ n: 1 })}\n\n`);
  expect(b.write).not.toHaveBeenCalled();
});

test('replays buffered events to a late subscriber', () => {
  hub.publish('u1', { n: 1 });
  const late = fakeRes();
  hub.subscribe('u1', late);
  expect(late.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ n: 1 })}\n\n`);
});

test('keeps only the last 5 events', () => {
  for (let i = 1; i <= 7; i += 1) hub.publish('u1', { n: i });
  const late = fakeRes();
  hub.subscribe('u1', late);
  expect(late.write).toHaveBeenCalledTimes(5);
  expect(late.write.mock.calls[0][0]).toContain('"n":3');
});

test('unsubscribe stops delivery', () => {
  const a = fakeRes();
  const off = hub.subscribe('u1', a);
  off();
  hub.publish('u1', { n: 1 });
  expect(a.write).not.toHaveBeenCalled();
});
