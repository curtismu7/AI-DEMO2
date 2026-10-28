import { importWithRetry, isChunkLoadError } from '../lazyWithRetry';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x.example/assets/Page-abc.js');

describe('lazyWithRetry', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('recognises the chunk-load failures of Chrome, Firefox, Safari and webpack-style names', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 7 failed.' })).toBe(true);
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('returns the module without reloading when the import works', async () => {
    const importer = vi.fn().mockResolvedValue({ default: 'Page' });
    const reload = vi.fn();
    await expect(importWithRetry(importer, { reload })).resolves.toEqual({ default: 'Page' });
    expect(importer).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on a chunk-load error (a deploy removed the chunk) and the promise never settles', async () => {
    const reload = vi.fn();
    let settled = false;
    importWithRetry(vi.fn().mockRejectedValue(chunkError()), { reload }).then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem('chunk-reload-at')).toMatch(/^\d+$/);
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
  });

  it('refuses to reload again within 30 seconds and surfaces the error instead (no reload loop)', async () => {
    const reload = vi.fn();
    window.sessionStorage.setItem('chunk-reload-at', String(Date.now() - 1000));
    await expect(importWithRetry(vi.fn().mockRejectedValue(chunkError()), { reload })).rejects.toThrow(/dynamically imported module/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the 30 second window has passed', async () => {
    const reload = vi.fn();
    window.sessionStorage.setItem('chunk-reload-at', String(Date.now() - 31000));
    importWithRetry(vi.fn().mockRejectedValue(chunkError()), { reload });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload for an ordinary error in the module', async () => {
    const reload = vi.fn();
    await expect(importWithRetry(vi.fn().mockRejectedValue(new Error('syntax problem in the page')), { reload })).rejects.toThrow('syntax problem');
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads when sessionStorage is unavailable (no loop is possible)', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    const reload = vi.fn();
    await expect(importWithRetry(vi.fn().mockRejectedValue(chunkError()), { reload })).rejects.toThrow(/dynamically imported module/);
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(window, 'sessionStorage', original);
  });
});
