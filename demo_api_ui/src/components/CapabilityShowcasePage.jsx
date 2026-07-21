import React from 'react';
import './CapabilityShowcasePage.css';

/**
 * Generic capability tour page — renders any ledger of the shared shape
 * ({id, group, title, oneLiner, evidence}) grouped under `groups`, in order.
 * PingOne Authorize is the first consumer; not specific to it.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.intro
 * @param {Array<{id:string,group:string,title:string,oneLiner:string,evidence:{code:string}}>} props.ledger
 * @param {Array<{id:string,label:string}>} props.groups
 */
export default function CapabilityShowcasePage({ title, intro, ledger, groups }) {
  return (
    <div className="cap-showcase">
      <header className="cap-showcase__header">
        <h1>{title}</h1>
        <p className="cap-showcase__intro">{intro}</p>
      </header>
      {groups.map((g) => (
        <section key={g.id} className="cap-showcase__group">
          <h2 className="cap-showcase__group-heading">{g.label}</h2>
          <div className="cap-showcase__grid">
            {ledger
              .filter((cap) => cap.group === g.id)
              .map((cap) => (
                <article key={cap.id} className="cap-card" data-testid={`cap-card-${cap.id}`}>
                  <h3 className="cap-card__title">{cap.title}</h3>
                  <p className="cap-card__one-liner">{cap.oneLiner}</p>
                  <code className="cap-card__evidence">{cap.evidence.code}</code>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
