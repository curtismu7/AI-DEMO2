// Shared Ping UI primitives (standalone Ping UI Standard P2-P7, re-created on AI-DEMO2 tokens).
// Styles live in src/styles/ping-ui.css (imported once from src/index.jsx). API: docs/ping-ui-primitives.md.
//
// A page is: <PingPage> <SimBanner/> <PageHeader/> <PageFrame> <Section>... </PageFrame> </PingPage>.
// Buttons are plain <button className="pu-btn"> (secondary) and "pu-btn pu-btn--primary" (exactly one per view).

const cx = (...parts) => parts.filter(Boolean).join(' ');

/** Page root: sets ground, ink and the --pu-accent the cards read. Pass className for a page hook. */
export function PingPage({ className, children, ...rest }) {
  return (
    <div className={cx('pu-page', className)} {...rest}>
      {children}
    </div>
  );
}

/** P2 simulation/status banner. Render it first inside PingPage, above the title. */
export function SimBanner({ children, ...rest }) {
  return (
    <div className="pu-banner-wrap">
      <div className="pu-banner" role="note" {...rest}>
        {children}
      </div>
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
