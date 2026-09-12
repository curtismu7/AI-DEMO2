/**
 * Response text size (A−/A+). The stored value is user-editable localStorage,
 * so an out-of-range or junk entry must fall back to the 120% default rather
 * than zooming the transcript to something unreadable.
 */
import { readStoredChatZoom } from '../AIAgent';

const set = (v) => window.localStorage.setItem('ba:chatZoom:v1', v);

test('defaults to 120% when nothing is stored', () => {
  window.localStorage.clear();
  expect(readStoredChatZoom()).toBe(1.2);
});

test('restores a stored value inside the range', () => {
  set('0.9');
  expect(readStoredChatZoom()).toBe(0.9);
});

test('falls back to the default for out-of-range or junk values', () => {
  set('9');
  expect(readStoredChatZoom()).toBe(1.2);
  set('0.1');
  expect(readStoredChatZoom()).toBe(1.2);
  set('banana');
  expect(readStoredChatZoom()).toBe(1.2);
});
