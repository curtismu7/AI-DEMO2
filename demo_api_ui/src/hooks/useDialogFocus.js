import { useEffect, useRef } from 'react';

// Shared dialog focus management: move focus in on open, keep Tab inside while a modal is the top one, and put focus
// back on the element that opened it when it closes. DraggableModal (and so ConfirmModal and every page modal built on
// it) and WelcomeWizard use it.

const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]';

function isTabbable(el) {
  if (el.tabIndex < 0) return false;
  if (el.closest('[hidden], [inert]')) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  // Content of a closed <details> is not focusable (its <summary> is).
  const details = el.closest('details:not([open])');
  if (details && !(el.tagName === 'SUMMARY' && el.parentElement === details)) return false;
  return true;
}

export function getTabbables(container) {
  return Array.from(container.querySelectorAll(TABBABLE)).filter(isTabbable);
}

// Open modals, oldest first. Only the last one traps Tab, so a modal opened from a modal works.
const stack = [];

/**
 * @param {React.RefObject<HTMLElement>} containerRef  the dialog element (give it tabIndex={-1})
 * @param {{ active: boolean, trap?: boolean }} options
 *   active  the dialog is open and wants focus management (false for non-modal floating panels)
 *   trap    Tab is held inside (false while a dialog is deliberately non-blocking, e.g. a docked card)
 */
export function useDialogFocus(containerRef, { active, trap = true }) {
  // Remember the opener while rendering: a child with autoFocus takes focus during the commit, before any effect of
  // ours could read document.activeElement.
  const openerRef = useRef(null);
  if (!active) openerRef.current = null;
  else if (openerRef.current === null && typeof document !== 'undefined') openerRef.current = document.activeElement || false;

  const trapRef = useRef(trap);
  trapRef.current = trap;

  useEffect(() => {
    if (!active) return undefined;
    const entry = { containerRef };
    // Read it now: the render that closes the dialog clears the ref before this cleanup runs.
    const opener = openerRef.current;
    stack.push(entry);

    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || !trapRef.current || stack[stack.length - 1] !== entry) return;
      const container = containerRef.current;
      if (!container) return;
      const items = getTabbables(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!container.contains(current) || current === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        // Only pull focus back if it was left in the (now removed) dialog or dropped to the page body; if a page handler
        // already put it somewhere deliberate, leave it.
        const now = document.activeElement;
        if (!now || now === document.body) opener.focus();
      }
    };
  }, [active, containerRef]);

  // Move focus in when the dialog opens, and again when a docked dialog is expanded back to a modal.
  useEffect(() => {
    if (!active || !trap) return;
    const container = containerRef.current;
    if (!container || container.contains(document.activeElement)) return;
    const target = container.querySelector('[data-autofocus]') || container;
    target.focus({ preventScroll: true });
  }, [active, trap, containerRef]);
}
