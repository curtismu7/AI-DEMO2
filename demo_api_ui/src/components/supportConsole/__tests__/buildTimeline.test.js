import { buildTimeline } from '../buildTimeline';

describe('buildTimeline', () => {
  it('returns viewed + status + created events newest-first', () => {
    const tl = buildTimeline({ status: 'Scheduled', createdAt: '2026-06-24' }, 'Maya Chen');
    expect(tl[0].title).toMatch(/viewed/i);
    expect(tl.some((e) => /Scheduled/.test(e.title))).toBe(true);
    expect(tl[tl.length - 1].title).toMatch(/created/i);
  });

  it('omits the created event when no createdAt', () => {
    const tl = buildTimeline({ status: 'Active' }, 'X');
    expect(tl.some((e) => /created/i.test(e.title))).toBe(false);
  });
});
