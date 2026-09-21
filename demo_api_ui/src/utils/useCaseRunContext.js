export function runContextFromLocation(location) {
  const state = location?.state;
  if (!state?.triggerText) return null;

  return state.runContext || {
    source: 'use-cases',
    useCaseId: state.useCaseId,
    triggerText: state.triggerText,
  };
}
