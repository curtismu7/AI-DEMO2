// Enter in any open modal clicks its default button: [data-default-button],
// then a submit button, then the first primary/confirm/ok-styled one.
// Typing targets with their own Enter meaning, and forms (native submit), are left alone.
// Returns the cleanup function, so it can be passed straight to useEffect.
export default function installModalEnterDefault() {
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('textarea,button,a,select,summary,[contenteditable="true"],form')) return;
    const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
    const btn = dialogs[dialogs.length - 1]?.querySelector(
      'button[data-default-button]:not(:disabled),button[type="submit"]:not(:disabled),' +
        'button[class*="primary"]:not(:disabled),button[class*="confirm"]:not(:disabled),button[class*="__ok"]:not(:disabled)'
    );
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
