import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';

vi.mock('react-toastify', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from 'react-toastify';
import { notifyError } from './appToast';

describe('notifyError message types', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a React element through so part of the text can be emphasised', () => {
    const el = createElement('strong', null, 'Start it');
    notifyError(el);
    expect(toast.error.mock.calls[0][0]).toBe(el);
  });

  it('still stringifies everything else, including an Error', () => {
    notifyError(new Error('boom'));
    notifyError('plain');
    expect(toast.error.mock.calls[0][0]).toBe('Error: boom');
    expect(toast.error.mock.calls[1][0]).toBe('plain');
  });
});
