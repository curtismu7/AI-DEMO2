import { describe, it, expect, vi } from 'vitest';
import {
  PAC_EDITOR_URL,
  PAC_EDITOR_COMMAND,
  probePacEditor,
} from '../pacEditorStatus';

describe('pacEditorStatus', () => {
  it('points at the pac-edit.sh default port on loopback', () => {
    expect(PAC_EDITOR_URL).toBe('http://127.0.0.1:9099');
    expect(PAC_EDITOR_COMMAND).toBe('./scripts/pac-edit.sh');
  });

  it('reports running when something answers on the port', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' });
    await expect(probePacEditor(fetchImpl)).resolves.toBe('running');
  });

  it('sends an opaque no-cors request (the editor sets no CORS headers)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' });
    await probePacEditor(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      PAC_EDITOR_URL,
      expect.objectContaining({ mode: 'no-cors' }),
    );
  });

  it('reports unknown when the request fails, since refused and blocked are indistinguishable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(probePacEditor(fetchImpl)).resolves.toBe('unknown');
  });

  it('reports unknown when the probe times out', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(probePacEditor(fetchImpl, 5)).resolves.toBe('unknown');
  });
});
