// Loads the Cedar engine (cedar-wasm web build) once, on first use. A dynamic import keeps the wasm out of the main
// bundle: only /standalone/cedar pays for it. The web build fetches cedar_wasm_bg.wasm itself via import.meta.url.
let loading;

export function loadCedar() {
  if (!loading) {
    loading = import('@cedar-policy/cedar-wasm/web').then(async (mod) => {
      await mod.default();
      return mod;
    });
    // A failed load must be retryable (e.g. offline), not cached as a permanent rejection.
    loading.catch(() => { loading = undefined; });
  }
  return loading;
}
