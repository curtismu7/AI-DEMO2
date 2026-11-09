// Shared Ping UI primitives (standalone Ping UI Standard P2-P7, re-created on AI-DEMO2 tokens).
// Styles live in src/styles/ping-ui.css (imported once from src/index.jsx). API: docs/ping-ui-primitives.md.
//
// A page is: <PingPage> <SimBanner/> <PageHeader/> <PageFrame> <Section>... </PageFrame> </PingPage>.
// Buttons are plain <button className="pu-btn"> (secondary) and "pu-btn pu-btn--primary" (exactly one per view).

import { useEffect, useId, useRef, useState } from 'react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/** Page root: sets ground, ink and the --pu-accent the cards read. Pass className for a page hook. */
export function PingPage({ className, children, ...rest }) {
  return (
    <div className={cx('pu-page', className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * P2 simulation/status banner. Render it first inside PingPage, above the title.
 *
 * The honest text is long (it says what is real and what is mocked) and on a phone it filled 41-80% of the screen.
 * At <= 600px (ping-ui.css) the banner is held to a few lines and a "More" button opens the rest. Nothing is removed:
 * the full text stays in the DOM, so a screen reader reads all of it, find-by-text still matches, and focusing a link
 * inside the clipped part opens the banner. The button exists only while the text is actually clipped, so on desktop
 * (and for a banner that already fits) nothing changes.
 */
export function SimBanner({ children, className, ...rest }) {
  const ref = useRef(null);
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Measure only while collapsed: expanded, nothing is clipped, and the last answer must keep the "Less" button.
    const measure = () => {
      if (!open) setClipped(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    document.fonts?.ready?.then(measure);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  });

  return (
    <div className="pu-banner-wrap">
      <div
        ref={ref}
        id={bodyId}
        className={cx('pu-banner', !open && 'pu-banner--clamp', className)}
        role="note"
        onFocus={() => setOpen(true)}
        {...rest}
      >
        {children}
      </div>
      {clipped || open ? (
        <button
          type="button"
          className="pu-btn pu-banner__more"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Less' : 'More'}
        </button>
      ) : null}
    </div>
  );
}

/** P3 centred 1100px frame for the page body (below the title band). */
export function PageFrame({ children }) {
  return <div className="pu-frame">{children}</div>;
}

/** P3 labelled section: kicker + h2 (+ optional lede), landmark named by the h2. */
export function Section({ id, kicker, title, lede, children }) {
  return (
    <section aria-labelledby={id}>
      <p className="pu-kicker">{kicker}</p>
      <h2 id={id} className="pu-h2">{title}</h2>
      {lede ? <p className="pu-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

/** P4 grid that wraps cards at phone width. */
export function CardGrid({ children }) {
  return <div className="pu-card-grid">{children}</div>;
}

/**
 * P4 card with a 4px top edge. tone: omit for the vertical accent, or
 * 'neutral' | 'ok' | 'live' | 'warn' | 'danger'. A toned card should also carry a StatusChip.
 */
export function Card({ tone, title, className, children, ...rest }) {
  return (
    <div className={cx('pu-card', tone && `pu-card--${tone}`, className)} {...rest}>
      {title ? <h3 className="pu-h3">{title}</h3> : null}
      {children}
    </div>
  );
}

/** P7 chip: dot plus the word. tone: 'ok' | 'info' | 'warn' | 'danger' | 'neutral'. Children (the word) are required. */
export function StatusChip({ tone = 'neutral', children }) {
  return (
    <span className={cx('pu-chip', `pu-chip--${tone}`)}>
      <span className="pu-chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** P5 key-value list. items: [{ label, value, mono? }]. */
export function KvList({ items }) {
  return (
    <dl className="pu-kv">
      {items.flatMap(({ label, value, mono }) => [
        <dt key={`${label}-k`}>{label}</dt>,
        <dd key={`${label}-v`} className={mono ? 'pu-mono' : undefined}>{value}</dd>,
      ])}
    </dl>
  );
}
