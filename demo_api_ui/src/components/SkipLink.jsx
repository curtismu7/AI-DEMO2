import "./SkipLink.css";

/**
 * First tab stop on every page: jumps over the shell (side nav, top bar, drawers) to the page's
 * <main>. Hidden until it has keyboard focus. The target is the first <main> in the document;
 * it is made programmatically focusable on use (tabindex -1) so the next Tab lands on the first
 * control inside the page, not back in the shell.
 */
export default function SkipLink() {
  const skip = (e) => {
    const main = document.querySelector("main");
    if (!main) return;
    e.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
  };
  return (
    <a className="skip-link" href="#main-content" onClick={skip} data-testid="skip-link">
      Skip to main content
    </a>
  );
}
